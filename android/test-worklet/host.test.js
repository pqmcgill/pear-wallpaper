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
