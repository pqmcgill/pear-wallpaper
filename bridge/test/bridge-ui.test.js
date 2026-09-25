const test = require('brittle')
const EventEmitter = require('events')

function pairTransport () {
  const a = new EventEmitter(); const b = new EventEmitter()
  return [
    { send: (m) => b.emit('message', m), onMessage: (cb) => a.on('message', cb) },
    { send: (m) => a.emit('message', m), onMessage: (cb) => b.on('message', cb) }
  ]
}

test('call() resolves with the reply value and matches by id', async (t) => {
  const { createBridgeUi } = await import('../bridge-ui.mjs')
  const [uiT, mainT] = pairTransport()
  mainT.onMessage((m) => { if (m.t === 'req') mainT.send({ t: 'res', id: m.id, ok: true, value: { echoed: m.cmd } }) })
  const bridge = createBridgeUi(uiT)
  t.alike(await bridge.call('getState'), { echoed: 'getState' })
})

test('call() rejects when the reply is ok:false', async (t) => {
  const { createBridgeUi } = await import('../bridge-ui.mjs')
  const [uiT, mainT] = pairTransport()
  mainT.onMessage((m) => { if (m.t === 'req') mainT.send({ t: 'res', id: m.id, ok: false, error: 'nope' }) })
  const bridge = createBridgeUi(uiT)
  await t.exception(() => bridge.call('createGroup'), /nope/)
})

test('on() delivers pushed events', async (t) => {
  const { createBridgeUi } = await import('../bridge-ui.mjs')
  const [uiT, mainT] = pairTransport()
  const bridge = createBridgeUi(uiT)
  const got = new Promise((res) => bridge.on('candidate', res))
  mainT.send({ t: 'evt', event: 'candidate', payload: { candidateKey: 'cc', name: 'Phone' } })
  t.alike(await got, { candidateKey: 'cc', name: 'Phone' })
})

test('failPending() rejects every in-flight call, and later calls still work', async (t) => {
  const { createBridgeUi } = await import('../bridge-ui.mjs')
  const [uiT, mainT] = pairTransport()
  const reqs = []
  mainT.onMessage((m) => { if (m.t === 'req') reqs.push(m) })
  const bridge = createBridgeUi(uiT)
  const a = bridge.call('createGroup')
  const b = bridge.call('joinGroup', 'INV')
  bridge.failPending(new Error('worker restarting'))
  await t.exception(() => a, /worker restarting/)
  await t.exception(() => b, /worker restarting/)
  mainT.send({ t: 'res', id: reqs[0].id, ok: true, value: 'late' })
  const c = bridge.call('getState')
  mainT.send({ t: 'res', id: reqs[2].id, ok: true, value: { ok: 1 } })
  t.alike(await c, { ok: 1 })
})
