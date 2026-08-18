const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { k } = require('../lib/apply.js')
const { trio, pairedDuo } = require('./helpers')

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
