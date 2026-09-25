const test = require('brittle')
const path = require('path')
const { createBridgeMain } = require('pear-wallpaper-bridge/main')
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')
const { pairedDuo, until } = require('pear-wallpaper-core/test/helpers')

function fakePng (size) {
  const buf = Buffer.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// In-memory duplex pair standing in for BareKit.IPC's two ends.
function duplexPair () {
  const { EventEmitter } = require('events')
  const a = new EventEmitter(); const b = new EventEmitter()
  a.write = (buf) => setImmediate(() => b.emit('data', buf))
  b.write = (buf) => setImmediate(() => a.emit('data', buf))
  return [a, b]
}

// #1 regression, Android side. The real RN apply path (bridge-ui over the
// duplex transport, apply-controller, bridge-main) against a real core
// that missed two sends while the phone was offline: the setter runs once,
// for the newest send, and the older one is never applied after it.
test('apply controller: a phone that missed two sends applies only the newest', async (t) => {
  const { creator, joiner } = await pairedDuo(t)
  const older = await creator.sendWallpaper(fakePng(4096), [joiner.deviceKey])
  const newer = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])
  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === newer.id
  })

  const [workletEnd, rnEnd] = duplexPair()
  createBridgeMain({ core: joiner, transport: createDuplexJsonTransport(workletEnd) }).start()
  const { createBridgeUi } = await import('pear-wallpaper-bridge/ui')
  const { createApplyController } = await import('../lib/apply-controller.js')
  const bridge = createBridgeUi(createDuplexJsonTransport(rnEnd))

  const applied = []
  const setter = async (filePath) => { applied.push(path.basename(filePath)) }
  await createApplyController({ bridge, setter }).applyPending()

  t.alike(applied, [newer.id + '.png'], 'the newest send is applied once and the older one is skipped')
})
