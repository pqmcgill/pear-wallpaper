const test = require('brittle')
const Hyperswarm = require('hyperswarm')
const BlindPairing = require('blind-pairing')
const z32 = require('z32')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const ops = require('../lib/ops.js')
const { k } = require('../lib/apply.js')
const { makeTestnet, tmpDir, until, eventFlush } = require('./helpers')

test('pairing: candidate request reaches the creator', async function (t) {
  t.plan(4)
  const tn = await makeTestnet(t)

  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const invite = await creator.createInvite()
  t.is(typeof invite, 'string')

  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())

  creator.on('pairing-request', ({ candidateKey, name }) => {
    t.is(candidateKey, joiner.deviceKey)
    t.is(name, 'phone')
  })

  joiner.joinGroup(invite).catch(() => {}) // resolves only after Task 5's approve
  t.is(joiner.groupStatus, 'joining')
})

test('pairing: createInvite is idempotent until consumed', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const a = await creator.createInvite()
  const b = await creator.createInvite()
  t.is(a, b, 'outstanding invite is reused, not multiplied')
})

test('pairing: createInvite stores a non-zero expiry', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  await creator.createInvite()
  const inv = await creator.base.view.get(k.invite)
  t.ok(inv.value.expires > Date.now(), 'invite carries a future expiry')
})

test('pairing: createInvite regenerates an expired, unredeemed invite', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const stale = await creator.createInvite()
  const before = await creator.base.view.get(k.invite)
  // Age it into the past via a creator-authored add-invite op (same
  // pattern as the Task 6 expiry gate test): apply accepts it since only
  // `expires` differs and the author is still the creator.
  await creator._append(ops.addInvite({
    id: before.value.id,
    invite: before.value.invite,
    publicKey: before.value.publicKey,
    expires: Date.now() - 1000
  }))
  await until(creator, 'update', async () => {
    const inv = await creator.base.view.get(k.invite)
    return inv !== null && inv.value.expires < Date.now()
  })

  const fresh = await creator.createInvite()
  t.not(fresh, stale, 'a fresh invite is minted, not the dead one re-served')
  const after = await creator.base.view.get(k.invite)
  t.ok(after.value.expires > Date.now(), 'the new view record carries a future expiry')
})

test('pairing: malformed candidate userData does not crash the creator', async function (t) {
  t.plan(2)
  const tn = await makeTestnet(t)

  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const invite = await creator.createInvite()

  // Drive blind-pairing's addCandidate directly, bypassing pairer.js's
  // JSON-encoded userData, so the creator receives attacker-chosen bytes
  // that are not valid JSON at all.
  const swarm = new Hyperswarm({ bootstrap: tn.bootstrap })
  const pairing = new BlindPairing(swarm)

  let sawRequest = false
  creator.on('pairing-request', () => { sawRequest = true })

  const candidate = pairing.addCandidate({
    invite: z32.decode(invite),
    userData: b4a.from('not json'),
    onadd: () => {}
  })
  // Close candidate, then pairing, then swarm — reverse of creation order.
  // (t.teardown runs registered teardowns FIFO, so a naive one-per-resource
  // registration here would destroy the swarm before closing the candidate
  // that depends on it; bundle them into one teardown in the right order.)
  t.teardown(async () => {
    await candidate.close().catch(() => {})
    await pairing.close().catch(() => {})
    await swarm.destroy().catch(() => {})
  })

  await until(creator, 'roster-changed', () => creator._connections && creator._connections.size > 0, 8000).catch(() => {})
  // Give the pairing request/response exchange (rides the same connection,
  // over protomux channels) a moment to actually reach _onCandidate.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await eventFlush()

  t.absent(sawRequest, 'creator does not emit pairing-request for malformed userData')
  t.is(await creator.createInvite(), invite, 'creator survives and is still functional')
})

// I3 regression. Only the supersede/success paths closed the candidate, so
// every natural failure (deny / used / expired) left a Candidate announcing
// and DHT-polling every ~7min for the process lifetime, unreachable
// (_activeJoin is already nulled). Android's restart-resume accumulates them.
test('pairing: a denied joinGroup closes its candidate', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const invite = await creator.createInvite()
  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())

  creator.on('pairing-request', ({ candidateKey }) => { creator.deny(candidateKey).catch(() => {}) })

  const join = joiner.joinGroup(invite)
  join.catch(() => {}) // observed by t.exception below; keep Node quiet meanwhile

  // Grab the candidate before _runJoin's finally nulls _activeJoin. Candidate
  // creation is local-only (corestore + keypair), so a tight poll wins the
  // race against the pairing round trip comfortably.
  let candidate = null
  const deadline = Date.now() + 5000
  while (candidate === null && Date.now() < deadline) {
    if (joiner._activeJoin !== null) candidate = joiner._activeJoin.candidate
    if (candidate === null) await new Promise((resolve) => setTimeout(resolve, 5))
  }
  t.ok(candidate !== null, 'candidate observed while the join was in flight')

  await t.exception(join, 'denied join rejects')
  t.ok(candidate.closed, 'the rejected candidate is closed, not left announcing on the DHT')
})

test('pairing: joinGroup with a different invite supersedes the stale attempt', async function (t) {
  t.plan(4)
  const tn = await makeTestnet(t)

  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const inviteA = await creator.createInvite()
  await creator._append(ops.delInvite())
  const inviteB = await creator.createInvite()

  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())

  const firstJoin = joiner.joinGroup(inviteA)
  await until(joiner, 'roster-changed', () => joiner._activeJoin !== null && joiner._activeJoin.candidate !== null, 5000)
  const firstCandidate = joiner._activeJoin.candidate

  let candidateKey = null
  creator.on('pairing-request', ({ candidateKey: ck }) => { candidateKey = ck })

  joiner.joinGroup(inviteB).catch(() => {})

  // The superseded attempt's promise must settle (not hang forever) with
  // a clear error — nothing else would ever wake it, since
  // blind-pairing's Candidate.close() neither fires onadd nor emits
  // 'rejected'.
  await t.exception(firstJoin, /superseded/, 'superseded join promise rejects clearly')

  await until(firstCandidate, 'close', () => firstCandidate.closed, 5000)
  t.ok(firstCandidate.closed, 'superseded candidate was closed')

  await until(joiner, 'roster-changed', () => joiner._activeJoin !== null && joiner._activeJoin.invite === inviteB, 5000)
  t.is(joiner._activeJoin.invite, inviteB, 'active join now tracks the new invite')

  await until(creator, 'pairing-request', () => candidateKey !== null, 8000)
  t.is(candidateKey, joiner.deviceKey, 'new join reaches the creator')
})
