const test = require('brittle')
const EventEmitter = require('events')
const { createBridgeMain } = require('../lib/bridge-main.js')

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
