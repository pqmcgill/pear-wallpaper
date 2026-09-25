const test = require('brittle')

test('resolveFilePath returns file.path directly when present', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath({ path: '/tmp/pic.jpg' }), '/tmp/pic.jpg')
})

test('resolveFilePath falls back to null when file.path is absent and pear-electron is unreachable (e.g. under test/plain Node)', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath({ name: 'pic.jpg' }), null)
})

test('resolveFilePath returns null for a falsy file', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath(null), null)
})

test('Send lists targetable devices (excludes self) and disables send with none chosen', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true }, { key: 'bb', name: 'Tablet', isSelf: false }], sends: [] }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Tablet/.test(html), 'lists a target')
  t.absent(/>Mac</.test(html.replace(/this device/g, '')), 'self not a target row')
})

test('Send disables the button until a file and at least one target are chosen', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'bb', name: 'Tablet', isSelf: false }], sends: [] }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/<button[^>]*disabled/.test(html), 'send button starts disabled')
})

test('Send shows per-target status from snapshot.sends', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false }],
    sends: [{ id: 's1', targets: [{ key: 'bb', status: 'delivered' }] }]
  }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/delivered/.test(html), 'shows target status')
})

test('Send target rows show whether each device is online', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }, { key: 'cc', name: 'Laptop', isSelf: false, online: false }],
    sends: []
  }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Tablet.*?online.*?Laptop/s.test(html), 'Tablet reads online')
  t.ok(/Laptop.*?offline/s.test(html), 'Laptop reads offline')
})

test('a pending send to an offline device says it is waiting for that device', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }, { key: 'cc', name: 'Laptop', isSelf: false, online: false }],
    sends: [{ id: 's1', targets: [{ key: 'bb', status: 'pending' }, { key: 'cc', status: 'pending' }] }]
  }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Waiting for Laptop to come online/.test(html), 'offline target explains the wait')
  t.absent(/Waiting for Tablet/.test(html), 'online target does not claim to be waiting for it to come online')
})
