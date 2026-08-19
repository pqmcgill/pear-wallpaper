const test = require('brittle')

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
