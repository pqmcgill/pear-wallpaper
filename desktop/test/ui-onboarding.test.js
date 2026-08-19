const test = require('brittle')

test('Onboarding renders create + join controls', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => {} } }))
  t.ok(/create/i.test(html), 'has a create control')
  t.ok(/join/i.test(html), 'has a join control')
})

test('qrSvg returns an <svg> string for an invite', async (t) => {
  const { qrSvg } = await import('../ui/qr.js')
  const svg = qrSvg('INVITE-ABC')
  t.ok(svg.includes('<svg'), 'produces svg markup')
})

test('Waiting shows a rejection message when snapshot carries a joinError', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Waiting } = await import('../ui/components/Waiting.js')
  const html = render(h(Waiting, { snapshot: { groupStatus: 'none', joinError: 'PAIRING_REJECTED' } }))
  t.ok(/denied|rejected/i.test(html))
})
