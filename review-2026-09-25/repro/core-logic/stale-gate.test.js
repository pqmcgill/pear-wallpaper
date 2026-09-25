const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../../../index.js')
const { k } = require('../../../lib/apply.js')
const { trio, until } = require('../../helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// Creator a revokes c while member b is offline. b restarts, c connects to
// b first (b's roster is stale, so c is admitted and replicating), then a
// comes online and b learns of the removal.
test('a restarted member keeps replicating with a revoked device after learning of the removal', async function (t) {
  const { a, b, c, tn } = await trio(t)
  const bDir = b.storageDir
  const aDir = a.storageDir
  const cSwarm = await c._swarmKeyHex()
  await b.close()
  await a.removeDevice(c.deviceKey)
  await a.close()

  const b2 = new WallpaperCore({ storageDir: bDir, deviceName: 'laptop', bootstrap: tn.bootstrap })
  await b2.ready()
  t.teardown(() => b2.close())
  const events = []
  b2.on('roster-changed', () => events.push('roster-changed'))
  await until(b2, 'roster-changed', () => b2._connections.has(cSwarm))
  t.ok(b2._replicating.has(b2._connections.get(cSwarm)), 'c is connected and replicating with b2 on the stale roster')

  const a2 = new WallpaperCore({ storageDir: aDir, deviceName: 'desktop', bootstrap: tn.bootstrap })
  await a2.ready()
  t.teardown(() => a2.close())
  await until(b2, 'update', async () => (await b2.listDevices()).length === 2)
  await new Promise((r) => setTimeout(r, 1500))
  t.comment('b2 roster size: ' + (await b2.listDevices()).length + '; roster-changed events on b2: ' + events.length)
  const conn = b2._connections.get(cSwarm)
  t.comment('c still in b2._connections: ' + !!conn + '; still replicating: ' + (conn ? b2._replicating.has(conn) : false))
  t.absent(conn, 'b2 dropped the revoked device once it learned of the removal')

  // Does the revoked device keep seeing new group traffic through b2?
  const { id } = await a2.sendWallpaper(fakePng(), [b2.deviceKey])
  let leaked = false
  try {
    await until(c, 'update', async () => (await c.base.view.get(k.send(id))) !== null, 8000)
    leaked = true
  } catch {}
  t.comment('revoked c received the new send op via b2: ' + leaked)
  t.absent(leaked, 'a revoked device must not receive post-revocation ops')
})
