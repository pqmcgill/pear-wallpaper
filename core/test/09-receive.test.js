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

// #1 regression. "Unapplied" is a relation between sends, not a per-send
// flag: acking the newest send to us retires every older one at once (the
// sender reads them as superseded, see _targetStatus). Filtering acked
// sends one at a time handed the older ones back on the next pull, so a
// device that missed several sends applied them newest-to-oldest and
// ended on the oldest.
test('receive: acking the newest send retires every older one (pull path)', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await creator.sendWallpaper(fakePng(4096 * (i + 1)), [joiner.deviceKey])).id)
  const newest = ids[2]

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === newest
  })
  await joiner.markApplied(newest)

  t.is(await joiner.pendingWallpaper(), null, 'older sends never resurface after the newest is acked')

  await until(creator, 'update', async () => (await creator.base.view.get(k.ack(newest, joiner.deviceKey))) !== null)
  const status = Object.fromEntries((await creator.listSends()).map((s) => [s.id, s.targets[0].status]))
  t.alike(ids.map((id) => status[id]), ['superseded', 'superseded', 'delivered'], 'sender sees the same rule')
})

test('receive: no wallpaper event for an older send once a newer one is acked (push path)', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const seen = []
  joiner.on('wallpaper', ({ id }) => seen.push(id))
  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'wallpaper', () => seen.includes(second.id))
  await joiner.markApplied(second.id)
  const announced = seen.length

  // Both the update-driven sweep and sync()'s receive step run _receive;
  // drive it directly once the ack is in the view so the assertion does
  // not race a background sweep.
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.ack(second.id, joiner.deviceKey))) !== null)
  await joiner._receive()
  t.alike(seen.slice(announced), [], 'nothing is announced after the ack')
})

// #3 regression. An update that landed while a receive sweep was inside
// its blob fetch used to be dropped: the sweep finished, announced the
// older send, and the newer one waited for some unrelated op to trigger
// the next sweep. Hold the first fetch on a gate to force the overlap.
test('receive: a send that lands mid-sweep is announced once the sweep finishes', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const materializeNow = joiner._materializeNow.bind(joiner)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let fetches = 0
  joiner._materializeNow = async (entry, filePath) => {
    if (++fetches === 1) await gate
    return materializeNow(entry, filePath)
  }
  const seen = []
  joiner.on('wallpaper', ({ id }) => seen.push(id))

  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  await until(joiner, 'update', () => fetches === 1)
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.send(second.id))) !== null)
  release()

  await until(joiner, 'wallpaper', () => seen.includes(second.id)).catch(() => {})
  t.ok(seen.includes(second.id), 'the newest send is announced without waiting for another op')
})
