const test = require('brittle')
const fs = require('fs')
const b4a = require('b4a')
const ops = require('../lib/ops.js')
const { k } = require('../lib/apply.js')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('receive: target gets wallpaper event with a real file', async function (t) {
  t.plan(4)
  const { creator, joiner } = await pairedDuo(t)

  joiner.on('wallpaper', async ({ id, filePath, fromKey, meta }) => {
    t.is(fromKey, creator.deviceKey)
    t.is(meta.ext, '.png')
    const bytes = await fs.promises.readFile(filePath)
    t.is(bytes.byteLength, 4096)
    t.ok(filePath.includes(id))
  })

  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
})

test('receive: pendingWallpaper pulls the same entry; non-targets see null', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)
  const entry = await joiner.pendingWallpaper()
  t.is(entry.fromKey, creator.deviceKey)

  t.is(await creator.pendingWallpaper(), null, 'sender is not a target')
})

test('receive: only the newest send per target surfaces', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === second.id
  })
  t.pass('stale send is skipped, newest surfaces')
})

// C3 regression. pendingWallpaper() is documented (README, spec §6) to
// return `entry | null` and never a hard error — the Android background
// recipe awaits it unguarded. A blob nobody can serve, or a malformed ref
// from a compromised member, is a skip, not a crash.
test('receive: an unfetchable blob makes pendingWallpaper resolve null, never throw', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  // The ref itself is validated, so garbage fails fast and clearly instead
  // of blowing up somewhere inside corestore.
  await t.exception(() => joiner.blobs.get({ core: 'nope', id: null }), /invalid blob ref/)

  const bad = ops.setWallpaper({
    from: creator.deviceKey,
    targets: [joiner.deviceKey],
    blob: { core: 'nope', id: null },
    meta: { ext: '.png', byteLength: 16, filename: null }
  })
  await creator._append(bad)
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.send(bad.id))) !== null)

  t.is(await joiner.pendingWallpaper(), null, 'resolves null rather than rejecting')
})
