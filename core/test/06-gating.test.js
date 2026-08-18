const test = require('brittle')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperblobs = require('hyperblobs')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const ops = require('../lib/ops.js')
const { k } = require('../lib/apply.js')
const { makeTestnet, tmpDir, until, eventFlush, pairedDuo } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

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

test('gate: an abandoned invite past its expiry no longer opens the gate', async function (t) {
  const { creator, tn } = await pairedDuo(t)

  // A fresh, unconsumed invite — nobody ever redeemed or burned it — then
  // artificially aged into the past via a creator-authored add-invite op
  // (apply accepts it: same id/invite/publicKey, only expires changes).
  await creator.createInvite()
  const before = await creator.base.view.get('invite')
  const ops = require('../lib/ops.js')
  await creator._append(ops.addInvite({
    id: before.value.id,
    invite: before.value.invite,
    publicKey: before.value.publicKey,
    expires: Date.now() - 1000
  }))
  await until(creator, 'update', async () => {
    const inv = await creator.base.view.get('invite')
    return inv !== null && inv.value.expires < Date.now()
  })

  let closed = false
  const stranger = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(() => stranger.destroy())
  stranger.on('connection', (conn) => {
    conn.on('error', () => {})
    conn.on('close', () => { closed = true })
  })
  stranger.join(creator.base.discoveryKey)

  await until(stranger, 'connection', () => closed)
  t.ok(closed, 'gate closed despite an invite row existing, because it is expired')
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

// C1 regression. The invite exemption must buy a SOCKET (blind-pairing
// rides it on its own protomux channel), never store.replicate: blob cores
// are unencrypted, so a blob ref is the whole capability, and an ex-member
// still holds the view's encryption key. Before the fix an outsider that
// knew only the discovery key + a ref could read wallpaper bytes for the
// whole 24h pairing window.
test('gate: an open invite admits the socket but not replication', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const payload = fakePng()
  const ref = await creator.blobs.put(payload)
  const invite = await creator.createInvite() // pairing window now open

  // The outsider: a fresh swarm keypair (never on the roster), knowing
  // only the group's discovery key and the blob ref.
  const store = new Corestore(await tmpDir(t))
  await store.ready()
  const swarm = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await swarm.destroy()
    await store.close()
  })
  let connected = false
  swarm.on('connection', (conn) => {
    conn.on('error', () => {}) // gate/revocation teardown surfaces as a reset here
    connected = true
    store.replicate(conn)
  })
  swarm.join(creator.base.discoveryKey)
  await swarm.flush()
  await until(swarm, 'connection', () => connected, 10000)

  const outsiderKey = b4a.toString(swarm.keyPair.publicKey, 'hex')
  await until(creator, 'roster-changed', () => creator._connections.has(outsiderKey), 10000)
  const conn = creator._connections.get(outsiderKey)
  t.ok(conn, 'the invite window keeps the socket open, so pairing can ride it')

  const core = store.get(b4a.from(ref.core, 'hex'))
  await core.ready()
  const blobs = new Hyperblobs(core)
  let bytes = null
  try {
    bytes = await blobs.get(ref.id, { timeout: 4000 })
  } catch {
    bytes = null // no peer served it: exactly what must happen
  }
  t.is(bytes, null, 'outsider cannot read wallpaper bytes during the pairing window')
  t.absent(creator._replicating.has(conn), 'because no store.replicate was attached to that socket')

  // ...and a legitimately paired joiner still can, once approved.
  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())
  creator.on('pairing-request', ({ candidateKey }) => {
    creator.approve(candidateKey).catch((e) => t.fail(e.message))
  })
  await joiner.joinGroup(invite)
  const fetched = await joiner.blobs.get(ref, { timeoutMs: 15000 })
  t.ok(b4a.equals(fetched, payload), 'an approved member replicates normally')
})

// C2 regression (part 1). `applied` is an authority op about ANOTHER
// device's state: unbound, any member could permanently suppress a peer's
// delivery (_newestUnappliedForMe skips acked sends, so retry is dead, not
// delayed) while showing the sender a false delivered check.
test('policy: apply ignores an `applied` op forged for another device', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.send(id))) !== null)

  // The creator forges the TARGET's ack. Author (creator) !== op.device
  // (joiner), so every honest apply must drop it.
  await creator._append(ops.applied({ sendId: id, device: joiner.deviceKey }))
  // Sentinel: a legitimate creator-authored op appended after the forgery.
  // Same writer, so once the joiner sees this, it has applied (and
  // ignored) the forged op too.
  await creator.createInvite()
  await until(joiner, 'update', async () => (await joiner.base.view.get(k.invite)) !== null)

  t.is(await joiner.base.view.get(k.ack(id, joiner.deviceKey)), null, 'no ack row on the target')
  t.is(await creator.base.view.get(k.ack(id, joiner.deviceKey)), null, 'nor on the forger (apply is deterministic)')
  const pending = await joiner.pendingWallpaper()
  t.ok(pending !== null && pending.id === id, 'target still sees the wallpaper as pending')
  const [send] = await creator.listSends()
  t.is(send.targets[0].status, 'pending', 'sender is not shown a false delivered check')
})

// C2 regression (part 2). `set-wallpaper.from` drives the "who sent this"
// UI and listReceived's fromKey — it must be the verified author.
test('policy: apply ignores a set-wallpaper with a spoofed `from`', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const forged = ops.setWallpaper({
    from: creator.deviceKey, // spoofed: the joiner is the actual author
    targets: [joiner.deviceKey],
    blob: await joiner.blobs.put(fakePng()),
    meta: { ext: '.png', byteLength: 4096, filename: null }
  })
  await joiner._append(forged)

  // Sentinel from the same writer, so the creator's view has provably
  // caught up past the forgery before we assert on it.
  const real = await joiner.sendWallpaper(fakePng(8192), [creator.deviceKey])
  await until(creator, 'update', async () => (await creator.base.view.get(k.send(real.id))) !== null)

  t.is(await creator.base.view.get(k.send(forged.id)), null, 'spoofed send never lands in the view')
  t.is(await joiner.base.view.get(k.send(forged.id)), null, 'nor on the forger (apply is deterministic)')
})
