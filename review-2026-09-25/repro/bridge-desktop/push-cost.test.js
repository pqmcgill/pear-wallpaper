const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('../../helpers.js')
const { createBridgeMain } = require('../../../../bridge/bridge-main.js')
const { createSyncEngine } = require('../../../../bridge/sync-engine.js')

function png (n) {
  const b = b4a.alloc(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.writeUInt32BE(n, 16)
  return b
}

test('state pushes and snapshot cost on the receiver per incoming send', { timeout: 600000 }, async (t) => {
  const { creator, joiner } = await pairedDuo(t)
  const pushes = []
  let isEnabledCalls = 0
  const transport = { send (m) { if (m.t === 'evt' && m.event === 'state') pushes.push({ at: Date.now(), sends: m.payload.sends.length, received: m.payload.received.length }) }, onMessage () {} }
  const loginItem = { async isEnabled () { isEnabledCalls++; return false } }
  const platform = { async setWallpaper () {} }
  const engine = createSyncEngine({ core: joiner, platform, intervalMs: 1e9 })
  engine.on('error', () => {})
  createBridgeMain({ core: joiner, transport, engine, platform, loginItem }).start()
  engine.start()
  const cTransport = { send () {}, onMessage () {} }
  createBridgeMain({ core: creator, transport: cTransport }).start()
  t.teardown(() => engine.stop())

  const N = Number(process.env.N || 60)
  const report = []
  for (let i = 0; i < N; i++) {
    const before = pushes.length
    const lb = isEnabledCalls
    await creator.sendWallpaper(png(i), [joiner.deviceKey])
    await until(joiner, 'update', async () => (await joiner.listReceived({ limit: 1000 })).length === i + 1, 30000)
    await new Promise((r) => setTimeout(r, 300))
    if (i % 20 === 0 || i === N - 1) {
      const t0 = Date.now(); await creator.listSends(); const listSendsMs = Date.now() - t0
      report.push(`send #${i + 1}: receiver state pushes=${pushes.length - before} launchctl-equivalent isEnabled calls=${isEnabledCalls - lb} creator listSends ms=${listSendsMs}`)
    }
  }
  for (const r of report) t.comment(r)
  t.comment(`total receiver pushes for ${N} sends: ${pushes.length}; last received length shown: ${pushes[pushes.length - 1].received}`)
  t.pass()
})
