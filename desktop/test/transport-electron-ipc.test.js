const test = require('brittle')

test('electron transport forwards send + onMessage to the injected api', async (t) => {
  // ui/electron-ipc.js is ESM (the renderer consumes it with no bundler),
  // so this CJS test file loads it via dynamic import — same idiom as the
  // ui-*.test.js files.
  const { createElectronTransport } = await import('../ui/electron-ipc.js')
  const sent = []; let handler = null
  const api = { send: (m) => sent.push(m), onMessage: (cb) => { handler = cb } }
  const tr = createElectronTransport(api)
  tr.send({ t: 'req', id: 1 }); t.alike(sent, [{ t: 'req', id: 1 }])
  const got = []; tr.onMessage((m) => got.push(m)); handler({ t: 'evt', event: 'state' })
  t.alike(got, [{ t: 'evt', event: 'state' }])
})
