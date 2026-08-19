const test = require('brittle')

test('ErrorBanner renders the message and a dismiss control when a message is set', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { ErrorBanner } = await import('../ui/components/ErrorBanner.js')
  const html = render(h(ErrorBanner, { message: 'boom', onDismiss: () => {} }))
  t.ok(/boom/.test(html), 'shows the error message')
  t.ok(/<button/.test(html), 'has a dismiss control')
})

test('ErrorBanner renders nothing when there is no message', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { ErrorBanner } = await import('../ui/components/ErrorBanner.js')
  const html = render(h(ErrorBanner, { message: null, onDismiss: () => {} }))
  t.is(html, '')
})
