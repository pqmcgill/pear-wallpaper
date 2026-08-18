const test = require('brittle')
const Hyperswarm = require('hyperswarm')
const { until, eventFlush, pairedDuo } = require('./helpers')

test('gate: a stranger on the topic gets its connection destroyed', async function (t) {
  // eslint-disable-next-line no-unused-vars
  const { creator, joiner, tn } = await pairedDuo(t)
  // pairedDuo leaves TWO members' swarms joined to the topic (creator and
  // joiner) — the stranger gets discovered by, and gated out by, both
  // independently, so this expects two destroyed connections, not one.
  const expectedGatekeepers = 2
  let closed = 0

  const stranger = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(() => stranger.destroy())
  stranger.on('connection', (conn) => {
    // A gate-rejected connection surfaces as an abrupt reset on this side
    // (the side that didn't initiate the destroy) — expected, not a failure.
    conn.on('error', () => {})
    conn.on('close', () => { closed++ })
  })
  stranger.join(creator.base.discoveryKey)
  // no invite outstanding (consumed by pairing) → gate closed on both peers

  await until(stranger, 'connection', () => closed >= expectedGatekeepers)
  t.is(closed, expectedGatekeepers, 'creator and joiner both dropped the stranger')
})

test('revocation: removed device loses connectivity and leaves the roster', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  await creator.removeDevice(joiner.deviceKey)
  await until(creator, 'update', async () => (await creator.listDevices()).length === 1)

  const roster = await creator.listDevices()
  t.is(roster.length, 1)
  t.is(roster[0].name, 'creator')

  await eventFlush()
  t.is(creator._connections.has(await joiner._swarmKeyHex()), false, 'connection torn down')
})

test('policy: a forged roster op from a non-creator is ignored by apply', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  await t.exception(() => joiner.removeDevice(creator.deviceKey), /only the creator/)

  // Bypass the method entirely — append the raw op, as a compromised
  // device would. Every honest peer's apply must ignore it.
  const ops = require('../lib/ops.js')
  await joiner._append(ops.removeDevice({ key: creator.deviceKey }))

  await until(creator, 'update', async () =>
    (await creator.base.view.get(`device/${joiner.deviceKey}`)) !== null
  )
  t.is((await creator.listDevices()).length, 2, 'creator still rostered on creator side')
  t.is((await joiner.listDevices()).length, 2, 'forged op ignored even on the forger')

  // Forged invite ops are equally inert (creator-only, ruled in design review)
  const BlindPairing = require('blind-pairing')
  const b4a = require('b4a')
  const forged = BlindPairing.createInvite(joiner.base.key)
  await joiner._append(ops.addInvite({
    id: b4a.toString(forged.id, 'hex'),
    invite: b4a.toString(forged.invite, 'hex'),
    publicKey: b4a.toString(forged.publicKey, 'hex'),
    expires: forged.expires
  }))
  // Assert on the forger's own view: apply is deterministic and identical on
  // every peer, so the op being ignored locally proves it is ignored everywhere.
  t.is(await joiner.base.view.get('invite'), null, 'forged invite never lands in the view')
})
