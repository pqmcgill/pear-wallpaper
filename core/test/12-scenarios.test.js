const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { trio, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// trio(t)'s own teardown (helpers.js) closes a/b/c idempotently and
// .catch()s each close, so this test relies on that rather than
// re-declaring the same close calls.
test('scenario: multi-target send delivers to both, each acks independently', async function (t) {
  const { a, b, c } = await trio(t)

  const { id } = await a.sendWallpaper(fakePng(), [b.deviceKey, c.deviceKey])
  for (const peer of [b, c]) {
    await until(peer, 'update', async () => (await peer.pendingWallpaper()) !== null)
    await peer.markApplied((await peer.pendingWallpaper()).id)
  }
  await until(a, 'update', async () => {
    const [send] = await a.listSends()
    return send.targets.every((x) => x.status === 'delivered')
  })
  const [send] = await a.listSends()
  t.is(send.id, id)
  t.is(send.targets.length, 2)
})

// This scenario closes all three members explicitly, mid-test, in a
// specific order (a, then b, then c) before reopening b2/c2 — that order
// matters here, so it stays explicit rather than relying on trio's
// teardown (which would run later anyway, against already-closed cores).
test('scenario: full state survives restart of every member', async function (t) {
  const { a, b, c } = await trio(t)
  const dirs = { a: a.storageDir, b: b.storageDir, c: c.storageDir }
  const bootstrap = a.bootstrap
  await a.sendWallpaper(fakePng(), [c.deviceKey])
  await b.sync({ timeoutMs: 15000 })
  await a.close(); await b.close(); await c.close()

  // Reopen with the SAME deviceNames trio() used for b and c ('laptop',
  // 'phone') — deviceName isn't part of identity (the autobase
  // local-writer key is), but reusing it keeps the reopened instance
  // representing the "same device" faithfully.
  const b2 = new WallpaperCore({ storageDir: dirs.b, deviceName: 'laptop', bootstrap })
  await b2.ready()
  const c2 = new WallpaperCore({ storageDir: dirs.c, deviceName: 'phone', bootstrap })
  await c2.ready()
  t.teardown(async () => { await b2.close(); await c2.close() })

  t.is(b2.groupStatus, 'member')
  t.is((await b2.listDevices()).length, 3)

  // Only b2 is online holding the relayed blob (a is still closed) — this
  // exercises relay delivery a second time, now via a restarted relay.
  await c2.sync({ timeoutMs: 15000 })
  t.ok((await c2.pendingWallpaper()) !== null, 'queued send survived everyone restarting')

  // The test's own name promises "every member" restarts, not just b/c —
  // reopen the creator too. Deferred until after the relay proof above so
  // a2 coming back online doesn't hand c2 a second, non-relay path to the
  // blob mid-proof.
  const a2 = new WallpaperCore({ storageDir: dirs.a, deviceName: 'desktop', bootstrap })
  await a2.ready()
  t.teardown(() => a2.close())

  t.is(a2.groupStatus, 'member')
  t.is((await a2.listDevices()).length, 3)
})

// Relies on trio(t)'s own teardown to close a/b/c.
test('scenario: revoked device cannot receive a subsequent send', async function (t) {
  const { a, b, c } = await trio(t)

  await a.removeDevice(c.deviceKey)
  await t.exception(
    () => a.sendWallpaper(fakePng(), [c.deviceKey]),
    /not in the roster/
  )
  const roster = await a.listDevices()
  t.is(roster.length, 2)

  // Prove revocation replicates, not just that the remover's own local
  // state changed: b's roster must converge to the same 2-member view.
  await until(b, 'update', async () => (await b.listDevices()).length === 2)
  t.is((await b.listDevices()).length, 2, 'revocation replicated to another member')
})
