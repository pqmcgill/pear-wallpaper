const test = require('brittle')
const { createBridgeMain } = require('pear-wallpaper-bridge/main')

function fakeTransport () {
  const sent = []; const handlers = []
  return {
    sent,
    send: (m) => sent.push(m),
    onMessage: (cb) => handlers.push(cb),
    inject: (m) => handlers.forEach((h) => h(m))
  }
}
function fakeCore () {
  const calls = []
  return {
    calls,
    deviceKey: 'k', deviceName: 'n', groupStatus: 'member',
    on: () => {},
    listDevices: async () => [], listSends: async () => [], listReceived: async () => [],
    pendingWallpaper: async () => { calls.push('pendingWallpaper'); return { id: 'w1', filePath: '/tmp/w1.jpg' } },
    markApplied: async (id) => { calls.push(['markApplied', id]) }
  }
}

test('pendingWallpaper and markApplied are bridge commands', async (t) => {
  const tr = fakeTransport(); const core = fakeCore()
  createBridgeMain({ core, transport: tr }).start()
  tr.inject({ t: 'req', id: 1, cmd: 'pendingWallpaper', args: [] })
  tr.inject({ t: 'req', id: 2, cmd: 'markApplied', args: ['w1'] })
  await new Promise((r) => setImmediate(r))
  const res1 = tr.sent.find((m) => m.t === 'res' && m.id === 1)
  const res2 = tr.sent.find((m) => m.t === 'res' && m.id === 2)
  t.alike(res1.value, { id: 'w1', filePath: '/tmp/w1.jpg' })
  t.ok(res2.ok)
  t.alike(core.calls[1], ['markApplied', 'w1'])
})

test('optional deps: absent loginItem/engine/platform degrade, not crash', async (t) => {
  const tr = fakeTransport()
  createBridgeMain({ core: fakeCore(), transport: tr }).start()
  tr.inject({ t: 'req', id: 1, cmd: 'getState', args: [] })
  tr.inject({ t: 'req', id: 2, cmd: 'setLoginAtLogin', args: [true] })
  tr.inject({ t: 'req', id: 3, cmd: 'reapply', args: ['w1'] })
  tr.inject({ t: 'req', id: 4, cmd: 'syncNow', args: [] })
  await new Promise((r) => setImmediate(r))
  const snap = tr.sent.find((m) => m.id === 1).value
  t.is(snap.lastSync, null)
  t.ok(!('loginAtLogin' in snap), 'loginAtLogin key omitted without loginItem')
  for (const id of [2, 3, 4]) {
    const r = tr.sent.find((m) => m.id === id)
    t.is(r.ok, false)
    t.ok(/unknown command/.test(r.error))
  }
})
