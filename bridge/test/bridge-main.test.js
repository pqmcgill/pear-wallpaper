const test = require('brittle')
const EventEmitter = require('events')
const { createBridgeMain } = require('../bridge-main.js')

function pairTransport () {
  const a = new EventEmitter(); const b = new EventEmitter()
  return [
    { send: (m) => b.emit('message', m), onMessage: (cb) => a.on('message', cb) },
    { send: (m) => a.emit('message', m), onMessage: (cb) => b.on('message', cb) }
  ]
}
function fakeCore () {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    deviceKey: 'aa', deviceName: 'Mac', groupStatus: 'member', calls: [],
    async listDevices () { return [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }] },
    async listSends () { return [] },
    async listReceived () { return [{ id: 'r1', fromKey: 'bb', meta: {}, filePath: '/r/r1.png', appliedAt: 1 }] },
    async createGroup () { this.calls.push(['createGroup']) },
    async createInvite () { this.calls.push(['createInvite']); return 'INVITE123' },
    async approve (k) { this.calls.push(['approve', k]) },
    async sendWallpaper (img, targets) { this.calls.push(['sendWallpaper', img, targets]); return { id: 'x' } }
  })
}

test('getState returns the documented snapshot shape', async (t) => {
  const [mainT, uiT] = pairTransport()
  const core = fakeCore()
  const loginItem = { async isEnabled () { return true } }
  const engine = { lastSync: 42, async syncNow () {} }
  createBridgeMain({ core, platform: {}, loginItem, engine, transport: mainT }).start()

  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res') res(m) }))
  uiT.send({ t: 'req', id: 1, cmd: 'getState', args: [] })
  const r = await reply
  t.ok(r.ok)
  t.alike(Object.keys(r.value).sort(), ['deviceKey','deviceName','groupStatus','lastSync','loginAtLogin','received','roster','sends'])
  t.is(r.value.loginAtLogin, true)
  t.is(r.value.lastSync, 42)
})

test('sendWallpaper command maps {filePath,targets} to positional core call', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 7) res(m) }))
  uiT.send({ t: 'req', id: 7, cmd: 'sendWallpaper', args: [{ filePath: '/a.png', targets: ['bb'] }] })
  await reply
  t.alike(core.calls.find((c) => c[0] === 'sendWallpaper'), ['sendWallpaper', '/a.png', ['bb']])
})

test('reapply looks up filePath in listReceived and calls platform.setWallpaper', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  const platform = { setCalls: [], async setWallpaper (p) { this.setCalls.push(p) } }
  createBridgeMain({ core, platform, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 8) res(m) }))
  uiT.send({ t: 'req', id: 8, cmd: 'reapply', args: ['r1'] })
  await reply
  t.alike(platform.setCalls, ['/r/r1.png'])
})

test("a core 'pairing-request' becomes a 'candidate' event on the ui transport", async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const got = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'evt' && m.event === 'candidate') res(m.payload) }))
  core.emit('pairing-request', { candidateKey: 'cc', name: 'Phone' })
  t.alike(await got, { candidateKey: 'cc', name: 'Phone' })
})

test("a failed command replies ok:false with the error message", async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  core.createGroup = async () => { throw new Error('already in a group (or joining one)') }
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 9) res(m) }))
  uiT.send({ t: 'req', id: 9, cmd: 'createGroup', args: [] })
  const r = await reply
  t.absent(r.ok); t.is(r.error, 'already in a group (or joining one)')
})

test("a rejecting snapshot read surfaces via 'error', not a throw", async (t) => {
  const onUnhandledRejection = (err) => t.fail('unhandled rejection: ' + err.message)
  process.on('unhandledRejection', onUnhandledRejection)
  t.teardown(() => process.removeListener('unhandledRejection', onUnhandledRejection))

  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  core.listDevices = async () => { throw new Error('roster read failed') }
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const got = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'evt' && m.event === 'error') res(m.payload) }))
  core.emit('update')
  t.alike(await got, { message: 'roster read failed' })
})

test('non-member snapshot is empty (roster, sends, received all [])', async (t) => {
  const [mainT, uiT] = pairTransport()
  const core = fakeCore()
  core.groupStatus = 'none'
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 10) res(m) }))
  uiT.send({ t: 'req', id: 10, cmd: 'getState', args: [] })
  const r = await reply
  t.ok(r.ok)
  t.alike(Object.keys(r.value).sort(), ['deviceKey','deviceName','groupStatus','lastSync','loginAtLogin','received','roster','sends'])
  t.alike(r.value.roster, [])
  t.alike(r.value.sends, [])
  t.alike(r.value.received, [])
})

function stateEvents (uiT) {
  const states = []
  uiT.onMessage((m) => { if (m.t === 'evt' && m.event === 'state') states.push(m.payload) })
  return states
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

test("an engine 'synced' pushes state carrying the new lastSync", async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  const engine = Object.assign(new EventEmitter(), { lastSync: null, async syncNow () {} })
  createBridgeMain({ core, engine, transport: mainT }).start()
  const states = stateEvents(uiT)
  engine.lastSync = 1234
  engine.emit('synced')
  await tick(100)
  t.is(states.length, 1)
  t.is(states[0]?.lastSync, 1234)
})

test('a burst of core events coalesces into at most two pushes, the last one current', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  let received = 0
  core.listReceived = async () => { await tick(5); return Array.from({ length: received }, (_, i) => ({ id: 'r' + i })) }
  createBridgeMain({ core, transport: mainT }).start()
  const states = stateEvents(uiT)
  for (const event of ['update', 'send-updated', 'update', 'wallpaper', 'roster-changed']) {
    received++
    core.emit(event)
    await tick(1)
  }
  await tick(150)
  t.ok(states.length >= 1 && states.length <= 2, `pushes=${states.length}`)
  t.is(states[states.length - 1].received.length, 5, 'final push reflects the latest state')
})

test('pushes stay in order when snapshot latency varies', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  let received = 0
  const delays = [100, 1, 80, 1, 60, 1]
  let calls = 0
  core.listReceived = async () => {
    const n = received
    await tick(delays[calls++ % delays.length])
    return Array.from({ length: n }, (_, i) => ({ id: 'r' + i }))
  }
  createBridgeMain({ core, transport: mainT }).start()
  const states = stateEvents(uiT)
  for (let i = 0; i < 6; i++) {
    received++
    core.emit('update')
    await tick(60)
  }
  await tick(800)
  const lengths = states.map((s) => s.received.length)
  t.alike(lengths, [...lengths].sort((a, b) => a - b), `pushes never go backwards: ${lengths}`)
  t.is(lengths[lengths.length - 1], 6, 'final push reflects the latest state')
})

test('the login-item probe runs once, not per push, and refreshes after setLoginAtLogin', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  let enabled = false; let probes = 0
  const loginItem = {
    async isEnabled () { probes++; return enabled },
    async enable () { enabled = true },
    async disable () { enabled = false }
  }
  createBridgeMain({ core, loginItem, transport: mainT }).start()
  const states = stateEvents(uiT)
  for (let i = 0; i < 4; i++) { core.emit('update'); await tick(100) }
  t.is(probes, 1, 'one launchctl probe across several pushes')
  t.is(states[states.length - 1].loginAtLogin, false)

  const reply = new Promise((resolve) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 11) resolve(m) }))
  uiT.send({ t: 'req', id: 11, cmd: 'setLoginAtLogin', args: [true] })
  t.ok((await reply).ok)
  await tick(100)
  t.is(states[states.length - 1].loginAtLogin, true, 'a push after the toggle shows the new value')
  t.is(probes, 2)
})
