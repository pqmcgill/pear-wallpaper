const test = require('brittle')
const tmp = require('test-tmp')
const { createCoreHost } = require('../worklet/host.js')
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')

// In-memory duplex pair standing in for BareKit.IPC's two ends.
function duplexPair () {
  const { EventEmitter } = require('events')
  const a = new EventEmitter(); const b = new EventEmitter()
  a.write = (buf) => setImmediate(() => b.emit('data', buf))
  b.write = (buf) => setImmediate(() => a.emit('data', buf))
  return [a, b]
}

test('init frame boots the real core; bridge answers; shutdown exits', async (t) => {
  t.plan(4)
  const [workletEnd, rnEnd] = duplexPair()
  let exited = false
  createCoreHost({ transport: createDuplexJsonTransport(workletEnd), exit: () => { exited = true } })

  const rn = createDuplexJsonTransport(rnEnd)
  const { createBridgeUi } = await import('pear-wallpaper-bridge/ui')
  const bridge = createBridgeUi(rn)
  const ready = new Promise((resolve) => bridge.on('ready', resolve))
  rn.send({ t: 'init', storageDir: await tmp(t), deviceName: 'test-droid' })
  await ready
  t.pass('ready event received')

  const snap = await bridge.call('getState')
  t.is(snap.groupStatus, 'none')
  t.is(snap.deviceName, 'test-droid')

  rn.send({ t: 'shutdown' })
  await new Promise((r) => setTimeout(r, 500))
  t.ok(exited, 'shutdown closed core and called exit')
})

test('init failure is terminal: error evt, exit(1), and a later init is ignored', async (t) => {
  t.plan(4)
  const fs = require('fs')
  const path = require('path')
  const [workletEnd, rnEnd] = duplexPair()
  let exitCode = 'not-called'
  createCoreHost({ transport: createDuplexJsonTransport(workletEnd), exit: (code) => { exitCode = code } })

  const rn = createDuplexJsonTransport(rnEnd)
  const { createBridgeUi } = await import('pear-wallpaper-bridge/ui')
  const bridge = createBridgeUi(rn)

  // A storageDir that can never become a directory (it's already a plain
  // file) makes WallpaperCore's real corestore open fail inside
  // core.ready() — ENOTDIR, not a mock.
  const dir = await tmp(t)
  const badStorageDir = path.join(dir, 'not-a-dir')
  fs.writeFileSync(badStorageDir, 'x')

  const error = new Promise((resolve) => bridge.on('error', resolve))
  rn.send({ t: 'init', storageDir: badStorageDir, deviceName: 'test-droid' })
  const payload = await error
  t.ok(payload && typeof payload.message === 'string', 'error evt carries a message')

  await new Promise((r) => setTimeout(r, 200))
  t.is(exitCode, 1, 'init failure calls exit(1)')

  // Terminal contract: recovery is relaunching the worklet, never
  // re-sending init on the same instance — a second init frame must not
  // produce 'ready'.
  let gotReady = false
  bridge.on('ready', () => { gotReady = true })
  rn.send({ t: 'init', storageDir: await tmp(t), deviceName: 'retry' })
  await new Promise((r) => setTimeout(r, 300))
  t.absent(gotReady, 'a later init frame is ignored after terminal failure')
  t.is(exitCode, 1, 'exit code from the second (ignored) init frame is unchanged')
})
