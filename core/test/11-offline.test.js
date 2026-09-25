const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const ops = require('../lib/ops.js')
const { k } = require('../lib/apply.js')
const { trio, pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('offline delivery: relay carries a send after the sender leaves', async function (t) {
  const { a, b, c } = await trio(t)
  t.teardown(async () => { await b.close() })

  const cDir = c.storageDir

  // 1. phone (c) goes offline
  await c.close()

  // 2. desktop (a) sends to phone, waits until laptop (b) relayed the blob, then leaves
  const { id } = await a.sendWallpaper(fakePng(), [c.deviceKey])
  await b.sync({ timeoutMs: 15000 }) // b pulls the op AND the blob, becoming the relay
  await a.close()

  // 3. phone returns; only the relay is online
  const c2 = new WallpaperCore({ storageDir: cDir, deviceName: 'phone', bootstrap: b.bootstrap })
  await c2.ready()
  t.teardown(() => c2.close())
  await c2.sync({ timeoutMs: 15000 })

  const entry = await c2.pendingWallpaper()
  t.ok(entry !== null, 'wallpaper delivered via relay')
  t.is(entry.id, id)
})

// Regression for the reviewer's finding: _settle's quiet window (250ms) is
// shorter than plausible replication latency, so without a first-update
// floor, sync() would return having ingested nothing whenever the peer's
// append lands after the quiet window starts. Here the creator appends
// 400ms after joiner.sync() starts — past the 250ms quiet window on its
// own — so this only passes if sync() actually waits for that first
// 'update' rather than racing a fixed short window. Condition-driven
// (Promise.all on the real append + the real sync call), no sleeps.
test('sync: first-update floor waits past the quiet window for in-flight replication', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  let sentId = null
  const delayedSend = new Promise((resolve) => {
    setTimeout(() => {
      creator.sendWallpaper(fakePng(), [joiner.deviceKey]).then(({ id }) => {
        sentId = id
        resolve()
      })
    }, 400)
  })

  await Promise.all([delayedSend, joiner.sync({ timeoutMs: 5000 })])

  const node = await joiner.base.view.get(k.send(sentId))
  t.ok(node !== null, 'op appended 400ms after sync started was still ingested')
})

// I2 regression. sync() is the Android shell's ONLY receive opportunity.
// A single blob nobody can serve used to eat the whole budget: relay ran
// before the receive step, and both steps were silently skipped whenever a
// prior update-driven sweep was still in flight (_relaying / _applyBusy).
// Here the joiner's event-driven receive sweep is deliberately wedged on an
// unfetchable blob (30s bound) before a perfectly fetchable wallpaper
// arrives — only sync() can deliver it.
test('sync: an unfetchable blob does not starve the receive step', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  // A send whose blob no peer can ever supply: a well-formed ref to a core
  // that does not exist. Appended raw, author-bound `from` so apply keeps it.
  const stuck = ops.setWallpaper({
    from: creator.deviceKey,
    targets: [joiner.deviceKey],
    blob: { core: 'ab'.repeat(32), id: { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 32 } },
    meta: { ext: '.png', byteLength: 32, filename: null }
  })
  await creator._append(stuck)
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.send(stuck.id))) !== null)
  await until(joiner, 'update', () => joiner._applyBusy === true, 5000)

  let got = null
  joiner.on('wallpaper', (entry) => { got = entry })
  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await joiner.sync({ timeoutMs: 15000 })
  t.ok(got !== null, 'sync() ran its receive step despite the stalled blob')
  t.is(got && got.id, id, 'and delivered the fetchable wallpaper, not the stuck one')
})

// #3 regression, relay side. Same drop-not-queue shape as the receive
// sweep: a send that landed while b's relay sweep was mid-fetch was not
// fetched until some later op re-triggered the sweep. b is not a target,
// so its only blobs.get calls are the relay's.
test('relay: a send that lands mid-sweep is fetched once the sweep finishes', async function (t) {
  const { a, b, c } = await trio(t)
  const get = b.blobs.get.bind(b.blobs)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let fetches = 0
  b.blobs.get = async (ref, opts) => {
    if (++fetches === 1) await gate
    return get(ref, opts)
  }

  await a.sendWallpaper(fakePng(), [c.deviceKey])
  await until(b, 'update', () => fetches === 1)
  const { id } = await a.sendWallpaper(fakePng(8192), [c.deviceKey])
  await until(b, 'update', async () => (await b.base.view.get(k.send(id))) !== null)
  release()

  const { blob } = (await b.base.view.get(k.send(id))).value
  await until(b, 'update', () => b.blobs.has(blob)).catch(() => {})
  t.ok(await b.blobs.has(blob), 'relay holds the send that landed while it was busy')
})
