const test = require('brittle')
const { createElectronTransport } = require('../lib/transport/electron-ipc.js')

test('electron transport forwards send + onMessage to the injected api', (t) => {
  const sent = []; let handler = null
  const api = { send: (m) => sent.push(m), onMessage: (cb) => { handler = cb } }
  const tr = createElectronTransport(api)
  tr.send({ t: 'req', id: 1 }); t.alike(sent, [{ t: 'req', id: 1 }])
  const got = []; tr.onMessage((m) => got.push(m)); handler({ t: 'evt', event: 'state' })
  t.alike(got, [{ t: 'evt', event: 'state' }])
})
