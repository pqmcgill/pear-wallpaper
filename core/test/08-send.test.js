const test = require('brittle')
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const fs = require('fs')
const path = require('path')
const { validateImage } = require('../lib/image.js')
const WallpaperCore = require('../index.js')
const { pairedDuo, until, tmpDir } = require('./helpers')

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
  t.exception(() => validateImage(b4a.from('not an image')), /Only JPEG, PNG and WebP/)
  t.exception(() => validateImage(fakePng(21 * 1024 * 1024)), /too big to send.*20 MB/)
})

test('checkImage: reads a picked file and gives the reason it cannot be sent, with no group needed', async function (t) {
  const dir = await tmpDir(t)
  const core = new WallpaperCore({ storageDir: path.join(dir, 'store'), deviceName: 'mac' })
  await core.ready()
  t.teardown(() => core.close())
  const png = path.join(dir, 'beach.png')
  fs.writeFileSync(png, fakePng())
  t.is(await core.checkImage(png), '.png')

  // An iPhone photo: an ISO-BMFF 'ftyp' box with the 'heic' brand.
  const heic = b4a.alloc(64)
  heic.set([0, 0, 0, 0x18], 0); heic.set(b4a.from('ftypheic'), 4)
  const renamed = path.join(dir, 'photo.jpg')
  fs.writeFileSync(renamed, heic)
  await t.exception(core.checkImage(renamed), /If this is an iPhone photo \(HEIC\), export it as a JPEG first/)

  const huge = path.join(dir, 'huge.png')
  fs.writeFileSync(huge, fakePng(21 * 1024 * 1024))
  await t.exception(core.checkImage(huge), /too big to send/)
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

// #2: meta.filename replicates to every member, so it must never carry the
// sender's local path (username, folder names).
test('sendWallpaper: meta.filename replicates only a basename, never the local path', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const p = path.join(await tmpDir(t), 'Family Photos', 'beach.png')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, fakePng())

  const { id } = await creator.sendWallpaper(p, [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.base.view.get(`send/${id}`)) !== null)
  t.is((await joiner.base.view.get(`send/${id}`)).value.meta.filename, 'beach.png')
})

test('sendWallpaper: an explicit filename (or null) wins over the path, and is basenamed too', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const staged = path.join(await tmpDir(t), '1787510958028-k3j9x0.png')
  fs.writeFileSync(staged, fakePng())

  const a = await creator.sendWallpaper(staged, [joiner.deviceKey], { filename: 'Grandma.png' })
  const b = await creator.sendWallpaper(fakePng(), [joiner.deviceKey], { filename: 'C:\\Users\\me\\Pictures\\dog.jpg' })
  const c = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const d = await creator.sendWallpaper(staged, [joiner.deviceKey], { filename: null })
  await until(joiner, 'update', async () => (await joiner.base.view.get(`send/${d.id}`)) !== null)
  const meta = async (id) => (await joiner.base.view.get(`send/${id}`)).value.meta
  t.is((await meta(a.id)).filename, 'Grandma.png')
  t.is((await meta(b.id)).filename, 'dog.jpg')
  t.is((await meta(c.id)).filename, null, 'a buffer with no filename sends none')
  t.is((await meta(d.id)).filename, null, 'filename: null sends none, even for a path')
})
