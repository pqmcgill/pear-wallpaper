const test = require('brittle')

test('the nav marks the open tab, and only that one', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { MainView } = await import('../ui/components/MainView.js')
  const bridge = { call: async () => {}, on: () => {} }
  const html = render(h(MainView, { bridge, snapshot: { roster: [], sends: [], received: [] } }))
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0]
  t.ok(/<button[^>]*aria-current="page"[^>]*>Devices</.test(nav), 'Devices, the first screen, is marked current')
  t.is(nav.match(/aria-current/g).length, 1, 'no other tab claims to be open')
})
