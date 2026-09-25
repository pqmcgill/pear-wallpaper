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

// A creator alone in a new group has nothing to do but invite someone, so
// Devices mints the invite on arrival instead of waiting for a click.
test('a creator alone in the group is shown an invite being made, without clicking', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }] }
  const html = render(h(DeviceList, { bridge: { call: async () => 'INVITE' }, snapshot, candidates: [] }))
  t.ok(/making an invite/i.test(html))
})

test('a creator with other devices is not shown an invite until asked', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }, { key: 'bb', name: 'Tablet', isSelf: false, isCreator: false, online: true }] }
  const html = render(h(DeviceList, { bridge: { call: async () => 'INVITE' }, snapshot, candidates: [] }))
  t.absent(/making an invite/i.test(html))
})

test('InviteCard wraps the full invite, says what to do with it, and keeps the QR small', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { InviteCard } = await import('../ui/components/DeviceList.js')
  const invite = 'y'.repeat(112)
  const html = render(h(InviteCard, { invite }))
  t.ok(html.includes(invite), 'the whole invite is in the page')
  t.ok(/<code[^>]*word-break:\s*break-all/.test(html), 'the invite wraps instead of running off the window')
  t.ok(/paste/i.test(html) && /scan/i.test(html), 'an instruction line says to paste it or scan the QR')
  t.ok(/<svg/.test(html), 'renders the QR')
  t.ok(/class="qr"[^>]*width:\s*\d+px/.test(html), 'the QR has a fixed small width')
})

test('each device shows online or offline as text, not only a colored dot', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }, { key: 'bb', name: 'Tablet', isSelf: false, isCreator: false, online: false }] }
  const html = render(h(DeviceList, { bridge: {}, snapshot, candidates: [] }))
  t.ok(/Mac.*?online/s.test(html), 'Mac reads online')
  t.ok(/Tablet.*?offline/s.test(html), 'Tablet reads offline')
})
