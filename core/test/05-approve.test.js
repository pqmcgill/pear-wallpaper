const test = require('brittle')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until } = require('./helpers')

async function createPair(t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())
  return { creator, joiner, tn }
}

test('approve: joiner becomes a member and both see the full roster', async function (t) {
  const { creator, joiner } = await createPair(t)

  const invite = await creator.createInvite()
  creator.on('pairing-request', ({ candidateKey }) => {
    creator.approve(candidateKey).catch((e) => t.fail(e.message))
  })

  await joiner.joinGroup(invite)
  t.is(joiner.groupStatus, 'member')

  await until(creator, 'update', async () => (await creator.listDevices()).length === 2)
  const creatorSees = await creator.listDevices()
  const joinerSees = await joiner.listDevices()
  t.is(creatorSees.length, 2)
  t.is(joinerSees.length, 2)
  const names = joinerSees.map((d) => d.name).sort()
  t.alike(names, ['creator', 'phone'])
  t.is(joinerSees.find((d) => d.isSelf).name, 'phone')
})

test('deny: candidate is dropped and the invite is dead', async function (t) {
  t.plan(4)
  const { creator, joiner } = await createPair(t)
  const invite = await creator.createInvite()

  creator.on('pairing-request', async ({ candidateKey }) => {
    await creator.deny(candidateKey)
    t.is(creator._pending.size, 0)
    const inv = await creator.base.view.get('invite')
    t.is(inv, null, 'deny burns the invite')
    t.pass('denied without throwing')
  })

  await t.exception(joiner.joinGroup(invite), 'denied join rejects instead of hanging')
})

test('close: an undecided pairing-request does not wedge close()', async function (t) {
  const { creator, joiner } = await createPair(t)
  const invite = await creator.createInvite()

  // Deliberately never approve/deny — creator.close() below must still
  // resolve promptly instead of wedging on the awaiting _onCandidate.
  creator.on('pairing-request', () => {})

  joiner.joinGroup(invite).catch(() => {})
  await until(creator, 'pairing-request', () => creator._pending.size > 0)

  const closed = creator.close()
  const timedOut = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000))
  const result = await Promise.race([closed.then(() => 'closed'), timedOut])
  t.is(result, 'closed', 'close() resolves even with an undecided candidate still pending')
})

test('close: does not wedge on a DHT-poll re-check of an undecided candidate', async function (t) {
  const { creator, joiner } = await createPair(t)
  const invite = await creator.createInvite()
  creator.on('pairing-request', () => {}) // nobody decides

  joiner.joinGroup(invite).catch(() => {})
  await until(creator, 'pairing-request', () => creator._pending.size > 0)

  // The previous test alone doesn't reproduce the critical bug the
  // reviewer found: Member._addRequest is awaited from TWO places —
  // the live connection's onmessage handler (fire-and-forget, harmless)
  // AND Member._poll()'s DHT-lookup loop (`_add()` -> `_addRequest()`,
  // blind-pairing/index.js ~411-470), which re-decodes the SAME wire
  // bytes into a new MemberRequest, sees the session already pending,
  // and re-awaits the SAME still-unsettled onadd promise. Member._close()
  // awaits that in-flight poll via `while (this._activePoll !== null)
  // await this._activePoll`, so if close() lands while that DHT-path
  // await is live, it hangs — but DEFAULT_POLL is ~7 minutes, so the real
  // poll almost never overlaps this test's window. Force the exact state
  // directly instead of hoping to win that race.
  const wireBytes = joiner._activeJoin.candidate.request.encode()
  const member = creator.member
  // Mirror _run()'s own contract for this field: it clears _activePoll
  // back to null once the call settles. Skipping that would leave
  // Member._abort()'s `while (this._activePoll !== null) await
  // this._activePoll` spinning in a tight loop forever once our fix
  // makes the promise resolve (it re-checks the condition and awaits an
  // already-settled promise indefinitely) — an artifact of driving this
  // internal field by hand, not a real blind-pairing behavior.
  member._activePoll = member._addRequest(wireBytes).finally(() => {
    if (member._activePoll !== null) member._activePoll = null
  })

  const closed = creator.close()
  const timedOut = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000))
  const result = await Promise.race([closed.then(() => 'closed'), timedOut])
  t.is(result, 'closed', 'close() resolves even while a DHT-poll re-check is in flight')
})

test('approve: burning the invite rejects other pending candidates on the same invite', async function (t) {
  const { creator, joiner, tn } = await createPair(t)
  const invite = await creator.createInvite()

  const second = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'tablet', bootstrap: tn.bootstrap
  })
  await second.ready()
  t.teardown(() => second.close())

  const seen = new Set()
  creator.on('pairing-request', ({ candidateKey }) => seen.add(candidateKey))

  const joinerPromise = joiner.joinGroup(invite)
  const secondPromise = second.joinGroup(invite)
  // Deny fires (from approve()'s burn-the-invite cleanup) well before we
  // get around to asserting on secondPromise below — attach a no-op
  // handler now so Node never sees it as unhandled in the meantime;
  // t.exception() still observes the same rejection independently.
  secondPromise.catch(() => {})

  await until(creator, 'pairing-request', () => seen.size === 2, 10000)

  await creator.approve(joiner.deviceKey)

  await joinerPromise
  await t.exception(secondPromise, 'second candidate on the burned invite is rejected')

  await until(creator, 'update', async () => (await creator.listDevices()).length === 2)
  t.is((await creator.listDevices()).length, 2, 'only the approved device landed in the roster')
})

// #4: the joiner quits while waiting for approval, relaunches, and the creator
// approves the request it was already shown. blind-pairing keys the member's
// pending request on a session token derived from the invite and the
// candidate's userData, both stable across the restart, so the resumed
// candidate is the same request to the creator and approve() reaches it.
test('approve: a join interrupted by close() resumes and completes on approve', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const invite = await creator.createInvite()

  const dir = await tmpDir(t)
  const joiner = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner.ready()
  let candidateKey = null
  creator.on('pairing-request', ({ candidateKey: ck }) => { candidateKey = ck })
  joiner.joinGroup(invite).catch(() => {})
  await until(creator, 'pairing-request', () => candidateKey !== null, 8000)
  await joiner.close()

  const joiner2 = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner2.ready()
  t.teardown(() => joiner2.close())
  // Approve only once the relaunched candidate has re-sent its request to
  // the creator (its first broadcast on a live channel), the way a human
  // approves after the joiner is back on the Waiting screen.
  await until(joiner2, 'roster-changed', () => {
    const active = joiner2._activeJoin
    return active !== null && active.candidate !== null && active.candidate.visited.size > 0
  }, 8000)
  await creator.approve(candidateKey)

  // groupStatus flips to member as soon as the base boots; the pending-invite
  // record is retired at the end of the join, so wait on that.
  await until(joiner2, 'update', async () => (await joiner2.meta.get('pending-invite')) === null)
  t.is(joiner2.groupStatus, 'member', 'resumed join completed on approve')
  await until(creator, 'update', async () => (await creator.listDevices()).length === 2)
  t.alike((await joiner2.listDevices()).map((d) => d.name).sort(), ['creator', 'phone'])
})
