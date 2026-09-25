const test = require('brittle')

async function renderApp (props) {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { AppView } = await import('../ui/components/AppView.js')
  const bridge = { call: async () => {}, on: () => {} }
  return render(h(AppView, { bridge, worker: 'running', onRetry: () => {}, onDismissError: () => {}, ...props }))
}

const empty = { roster: [], sends: [], received: [] }

test('before the first state arrives, shows Starting rather than Onboarding', async (t) => {
  const html = await renderApp({ snapshot: { ...empty, groupStatus: null } })
  t.ok(/Starting/.test(html))
  t.absent(/Create a group/.test(html), 'no Onboarding for a device whose state is unknown')
})

test('while the worker restarts, a member device shows Starting, not its stale view', async (t) => {
  const html = await renderApp({ worker: 'restarting', snapshot: { ...empty, groupStatus: 'member' } })
  t.ok(/Starting/.test(html))
})

test('once restarts are exhausted, says the app stopped and offers Try again', async (t) => {
  const html = await renderApp({ worker: 'failed', snapshot: { ...empty, groupStatus: 'member', lastError: 'Pear Wallpaper is restarting. Try again in a moment.' } })
  t.ok(/stopped working/.test(html))
  t.absent(/error-banner/.test(html), 'no contradictory restarting banner over the stopped screen')
  t.ok(/Try again/.test(html))
  t.absent(/Create a group/.test(html))
})

test('a device known to be outside a group still gets Onboarding', async (t) => {
  const html = await renderApp({ snapshot: { ...empty, groupStatus: 'none' } })
  t.ok(/Create a group/.test(html))
})
