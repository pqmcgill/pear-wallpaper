const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { trio } = require('./helpers')

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
