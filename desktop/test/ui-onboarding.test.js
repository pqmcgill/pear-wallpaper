const test = require('brittle')

test('Onboarding renders create + join controls', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => {} } }))
  t.ok(/create/i.test(html), 'has a create control')
  t.ok(/join/i.test(html), 'has a join control')
})

test('Onboarding create control renders without a createError when bridge.call succeeds', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => 'INVITE-XYZ' } }))
  t.absent(/create-error/.test(html))
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

// blind-pairing-core formats a joinGroup() rejection's Error#message as
// `${code}: ${msg}` (e.g. 'INVITE_EXPIRED: Invite has expired'), never the
// bare code — an exact-match lookup on the whole message always falls
// through to the generic copy (the bug this branch's review discovered).
// friendlyJoinError is exported from Onboarding.js the same way Send.js
// exports resolveFilePath, purely so this prefix-matching logic can be
// exercised directly without simulating a DOM click through
// preact-render-to-string's static rendering.
test('friendlyJoinError prefix-matches a coded rejection message to its friendly copy', async (t) => {
  const { friendlyJoinError } = await import('../ui/components/Onboarding.js')
  t.is(friendlyJoinError('PAIRING_REJECTED: Pairing was rejected'), 'The creator denied this device.')
  t.is(friendlyJoinError('INVITE_USED: Invite has been used'), 'That invite was already used. Ask for a fresh one.')
  t.is(friendlyJoinError('INVITE_EXPIRED: Invite has expired'), 'That invite expired. Ask for a fresh one.')
  t.is(friendlyJoinError('superseded by a newer invite'), 'That join attempt was replaced by a newer one.')
  t.is(friendlyJoinError('closed'), 'The connection closed before joining finished.')
})

test('friendlyJoinError falls back to generic copy for an unrecognized message', async (t) => {
  const { friendlyJoinError } = await import('../ui/components/Onboarding.js')
  t.is(friendlyJoinError('some weird error'), 'Could not join. Ask for a fresh invite.')
})

// Same prefix-matching fix, ported to Waiting's own lookup (its joinError
// can arrive via a live candidate connection routing here before
// joinGroup() settles, or via a resumed pending join on startup) — covers
// the same 5 codes Onboarding does.
test('Waiting prefix-matches each coded joinError to its friendly copy', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Waiting } = await import('../ui/components/Waiting.js')
  const cases = [
    ['PAIRING_REJECTED: Pairing was rejected', 'The creator denied this device.'],
    ['INVITE_USED: Invite has been used', 'That invite was already used. Ask for a fresh one.'],
    ['INVITE_EXPIRED: Invite has expired', 'That invite expired. Ask for a fresh one.'],
    ['superseded by a newer invite', 'That join attempt was replaced by a newer one.'],
    ['closed', 'The connection closed before joining finished.']
  ]
  for (const [joinError, expected] of cases) {
    const html = render(h(Waiting, { snapshot: { joinError } }))
    t.ok(html.includes(expected), `${joinError} -> ${expected}`)
  }
})

test('Waiting falls back to generic copy for an unrecognized joinError', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Waiting } = await import('../ui/components/Waiting.js')
  const html = render(h(Waiting, { snapshot: { joinError: 'some weird error' } }))
  t.ok(html.includes('Could not join. Ask for a fresh invite.'))
})

test('Onboarding says in one line what the app is for', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => {} } }))
  t.ok(/wallpaper/i.test(html.replace(/<h1>Pear Wallpaper<\/h1>|<title>.*<\/title>/g, '')), 'an intro line beyond the heading')
})

// With nothing pasted there is nothing to join; the button waits for an
// invite instead of failing with "Ask for a fresh invite".
test('Join a group is disabled until an invite is pasted, and the join area says to paste one', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => {} } }))
  t.ok(/<button[^>]*disabled[^>]*>Join a group<\/button>/.test(html), 'join disabled while empty')
  t.ok(/paste it/i.test(html), 'a hint says to paste the invite')
})
