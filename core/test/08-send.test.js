const test = require('brittle')
const b4a = require('b4a')
const { validateImage } = require('../lib/image.js')
const WallpaperCore = require('../index.js')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('validateImage: sniffs formats, rejects junk and oversize', function (t) {
  t.is(validateImage(fakePng()), '.png')
  const jpg = b4a.alloc(64); jpg.set([0xff, 0xd8, 0xff], 0)
  t.is(validateImage(jpg), '.jpg')
  const webp = b4a.alloc(64)
  webp.set(b4a.from('RIFF'), 0); webp.set(b4a.from('WEBP'), 8)
  t.is(validateImage(webp), '.webp')
  t.exception(() => validateImage(b4a.from('not an image')), /unsupported/)
  t.exception(() => validateImage(fakePng(21 * 1024 * 1024)), /20 MB/)
})

test('sendWallpaper: op lands in both views, status pending', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  t.is(typeof id, 'string')

  const sends = await creator.listSends()
  t.is(sends.length, 1)
  t.is(sends[0].targets.length, 1)
  t.is(sends[0].targets[0].key, joiner.deviceKey)
  t.is(sends[0].targets[0].status, 'pending')

  await until(joiner, 'update', async () => (await joiner.base.view.get(`send/${id}`)) !== null)
  t.pass('op replicated to the target')
})

// I1 regression. listSends() is "this device's sent history" (README) and
// backs the per-device delivered-check UI — a peer's sends must not show up
// in it as if we had sent them.
test('listSends: only this device\'s own sends appear', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const { id } = await joiner.sendWallpaper(fakePng(), [creator.deviceKey])
  await until(creator, 'update', async () => (await creator.base.view.get(`send/${id}`)) !== null)

  t.is((await creator.listSends()).length, 0, "another device's send is not in our sent history")
  const mine = await joiner.listSends()
  t.is(mine.length, 1)
  t.is(mine[0].id, id, 'the sender still sees its own send')
})

test('sendWallpaper: rejects unknown targets', async function (t) {
  const { creator } = await pairedDuo(t)
  await t.exception(
    () => creator.sendWallpaper(fakePng(), ['ab'.repeat(32)]),
    /not in the roster/
  )
})
