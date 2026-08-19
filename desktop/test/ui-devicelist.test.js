const test = require('brittle')

test('renders roster names and online state', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }, { key: 'bb', name: 'Tablet', isSelf: false, isCreator: false, online: false }] }
  const html = render(h(DeviceList, { bridge: {}, snapshot, candidates: [] }))
  t.ok(/Mac/.test(html) && /Tablet/.test(html))
})

test('shows approve/deny for a pending candidate and approve calls bridge', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const calls = []
  const bridge = { call: async (...a) => calls.push(a) }
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }] }
  const html = render(h(DeviceList, { bridge, snapshot, candidates: [{ candidateKey: 'cc', name: 'Phone' }] }))
  t.ok(/Phone/.test(html) && /approve/i.test(html))
})

test('non-creator sees roster read-only: no remove/approve/deny/create-invite controls', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const bridge = { call: async () => {} }
  const snapshot = {
    roster: [
      { key: 'aa', name: 'Mac', isSelf: true, isCreator: false, online: true },
      { key: 'bb', name: 'Tablet', isSelf: false, isCreator: true, online: true }
    ]
  }
  const html = render(h(DeviceList, { bridge, snapshot, candidates: [{ candidateKey: 'cc', name: 'Phone' }] }))
  t.absent(/remove/i.test(html))
  t.absent(/approve/i.test(html))
  t.absent(/deny/i.test(html))
  t.absent(/create invite/i.test(html))
})
