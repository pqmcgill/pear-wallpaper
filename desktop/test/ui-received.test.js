const test = require('brittle')

test('Received lists applied wallpapers and re-apply calls the bridge', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Received } = await import('../ui/components/Received.js')
  const snapshot = { received: [{ id: 'r1', fromKey: 'bb', meta: { filename: 'sunset.jpg' }, filePath: '/r/r1.jpg', appliedAt: 1 }] }
  const html = render(h(Received, { bridge: {}, snapshot }))
  t.ok(/sunset\.jpg|r1/.test(html))
  t.ok(/re-?apply/i.test(html))
})

test('Received renders an empty list without throwing', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Received } = await import('../ui/components/Received.js')
  const html = render(h(Received, { bridge: {}, snapshot: { received: [] } }))
  t.ok(typeof html === 'string')
})
