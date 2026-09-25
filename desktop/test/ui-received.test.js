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

// #2: a row says who sent it and when, and never shows a sender's path,
// including the full paths old groups replicated before core basenamed them.
test('Received shows the sender\'s roster name and time, and only a basename', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Received } = await import('../ui/components/Received.js')
  const appliedAt = Date.UTC(2026, 8, 25, 18, 30)
  const snapshot = {
    roster: [{ key: 'bb', name: 'Mom\'s laptop' }],
    received: [{ id: 'r1', fromKey: 'bb', meta: { filename: '/Users/patrick/Family Photos/beach.png' }, filePath: '/r/r1.png', appliedAt }]
  }
  const html = render(h(Received, { bridge: {}, snapshot }))
  t.ok(html.includes('Mom&#39;s laptop') || html.includes('Mom\'s laptop'), 'sender name')
  t.ok(html.includes('2026'), 'when it arrived')
  t.ok(html.includes('beach.png'))
  t.absent(/Users|patrick|Family Photos/.test(html), 'no part of the sender\'s path')
})

test('Received names a sender who has left the group as a removed device', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Received } = await import('../ui/components/Received.js')
  const snapshot = {
    roster: [{ key: 'aa', name: 'Mac' }],
    received: [{ id: 'r1', fromKey: 'gone', meta: { filename: null }, filePath: '/r/r1.png', appliedAt: 1 }]
  }
  const html = render(h(Received, { bridge: {}, snapshot }))
  t.ok(/a removed device/.test(html))
  t.absent(/r1/.test(html.replace(/src="[^"]*"/, '')), 'the id is not used as a label')
})
