# API divergences from task briefs

Record any place the pinned dependency's real API differs from what a task
brief assumed, and how it was resolved. One entry per divergence.

## Task 3: Autobase constructor needs `valueEncoding: 'json'`

- **Brief assumed:** `new Autobase(this.store, key, { encrypt, encryptionKey, open, apply })`
  with ops appended as plain JS objects, no `valueEncoding` option.
- **Reality (autobase@7.28.1):** `Autobase`'s default `valueEncoding` is
  `'binary'` (`this.valueEncoding = c.from(handlers.valueEncoding || 'binary')`
  in `autobase/index.js`). Appending a plain object under the binary encoding
  fails deep inside `compact-encoding` with
  `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range ... Received NaN`
  (compact-encoding tries to read `.byteLength` off a plain object).
- **Resolution:** added `valueEncoding: 'json'` to the Autobase constructor
  options in `core/index.js` `_boot()`, exactly as the task instructions
  anticipated ("If appends fail to round-trip as JSON objects, add
  `valueEncoding: 'json'`"). Ops remain plain JSON objects in `ops.js`/`apply.js`,
  unchanged from the brief.
- **Everything else checked against the brief matched the installed
  autobase@7.28.1 source, no changes needed:**
  - `node.from.key` — `apply-state.js` sets `from: node.writer.core` (a
    Hypercore instance) on each apply-batch entry; `node.from.key` is that
    core's public-key Buffer. Confirmed by autobase's own internal use of
    `node.from.key` in `createAnchor()` (`lib/apply-state.js:1465`).
  - `apply(nodes, view, base)`'s third argument is a `PrivateApplyCalls`
    instance (`lib/apply-calls.js`) with `addWriter(key, opts)` and
    `removeWriter(key)` methods — matches the brief's `base.addWriter(...)` /
    `base.removeWriter(...)` calls.
  - `open: (store) => ...` receives the `AutoStore` as its first argument;
    `store.get('view')` — a bare string — is normalized to `{ name: 'view' }`
    inside `AutoStore.get()` (`lib/store.js:193-201`), matching
    `reference/autopass/index.js`'s usage.
  - `encrypt: true` with `encryptionKey: undefined` on first `createGroup()`
    causes `boot()` (`lib/boot.js`) to generate and persist a fresh encryption
    key on the local core; passing the persisted hex back in as
    `encryptionKey` on reopen reuses it. Matches the brief's reopen path via
    `meta.get('group')`.

## Task 4: blind-pairing API matched the brief; two minor notes

- **Checked against installed `blind-pairing@2.x` and `blind-pairing-core`
  source** (`core/node_modules/blind-pairing/index.js`,
  `core/node_modules/blind-pairing-core/index.js`): `Member`'s `onadd`
  receives a `MemberRequest` (has `.inviteId`, `.open(publicKey)` →
  returns/sets `.userData`, `.confirm({key, encryptionKey, additional})`,
  `.deny()`), and `Candidate`'s `onadd` receives the resolved
  `{ key, encryptionKey, data }` auth object. `member.flushed()` exists on
  `Member` and proxies to the swarm discovery-topic's `.flushed()`.
  `BlindPairing.createInvite(key)` returns
  `{ id, invite, seed, publicKey, additional, discoveryKey, expires,
  sensitive, testInvitation }` — the brief's destructuring of
  `{ id, invite, publicKey, expires }` is a correct subset. No code changes
  were needed beyond what the brief specified verbatim.
- **`additional` is `null` in this task:** `createInvite` is called with no
  second argument, so `blind-pairing-core`'s `createInvite(key, opts = {})`
  never receives `opts.data`, making `additional: null`. Nothing to thread
  through Task 5 as a result — the invite record stored in the view
  (`id`, `invite`, `publicKey`, `expires`) has no `additional` field to add.
  Flagged per the task-4 instructions for the controller to confirm Task 5
  doesn't need it.
- **Unused `compact-encoding` (`c`) import:** the brief's Step 3 require
  block for `core/index.js` lists `const c = require('compact-encoding')`,
  copied from the autopass reference (which uses `c.encode`/`c.decode` for
  structured `userData`/invite metadata). This task's candidate `userData`
  is plain JSON (per the interface spec), so `c` ends up unused in
  `index.js`. Kept the require for fidelity to the brief's verbatim code
  rather than silently dropping it; noting it here as a leftover rather
  than a functional divergence.

## Task 4 (review fix round): candidate-side error surface for expired/used/denied invites

Investigated per review finding 4: does blind-pairing expose *any* way for
the candidate to observe a member's non-zero-status response (rejected /
invite-used / invite-expired), given `Candidate._poll()`
(`core/node_modules/blind-pairing/index.js:650-667`) wraps everything in a
`try { ... } catch { /* can run in bg, should never crash it */ }` that
swallows thrown errors?

- **A real surface exists, one level down.** `Candidate._addResponse()`
  (`blind-pairing/index.js:559-571`) calls
  `this.request.handleResponse(value)`. `request` is a `CandidateRequest`
  (`blind-pairing-core/index.js:35-168`), and `CandidateRequest
  .handleResponse()` (line 77) internally does
  `try { this._openResponse(payload) } catch (err) { this.emit('rejected',
  err); return null }`. `_openResponse()` (line 94) is where the coded
  errors actually throw — `PAIRING_REJECTED` (status 1), `INVITE_USED`
  (status 2), `INVITE_EXPIRED` (status 3) at lines 108-118. So the error
  never reaches `Candidate._poll()`'s catch at all (it's caught one level
  down, inside `handleResponse`) — instead it comes out as a `'rejected'`
  event **on `candidate.request`** (a plain Node `EventEmitter`,
  `blind-pairing-core/index.js:1,35`), with the real `PairingError`
  (`.code` one of `PAIRING_REJECTED`/`INVITE_USED`/`INVITE_EXPIRED`,
  `blind-pairing-core/lib/errors.js`) as the argument. `Candidate` itself
  never relays this event — `candidate.request` has to be listened to
  directly.
- **Resolution:** `core/lib/pairer.js`'s `requestJoin()` now listens on
  `candidate.request.on('rejected', (err) => reject(err))` right after
  creating the candidate (before any polling starts, since
  `Candidate._open()` — where polling begins — only runs after the
  `ReadyResource` constructor's deferred `this.ready()`, so there's no
  race). This turns a genuine member-side denial/expiry/reuse into a
  clear rejection of `joinGroup()`'s promise, satisfying spec §6's
  "expired/used invites fail with a clear message" for the case where a
  response is ever actually sent back.
- **Residual gap, left as documented, not hacked around:** this task's own
  `_onCandidate` (the *member* side) reacts to an expired invite by
  silently returning — i.e. it never calls `request.deny({ status: 3 })`,
  so no response is ever sent and the candidate never receives the
  `'rejected'` event for *that* case; it just keeps polling until
  superseded (finding 3's recovery path) or the process closes. Wiring an
  explicit `deny()` call for the expiry case was judged out of this task's
  scope (the review ruling only asked `_onCandidate` to "ignore" expired
  candidates); it would be a natural, small follow-up if a clean
  candidate-side error message for *this specific* case is wanted, since
  the plumbing (`candidate.request`'s `'rejected'` event) is now already
  wired end-to-end and will fire correctly for it.
- **Also confirmed while investigating:** `Autobase.prototype
  .waitForWritable()` exists at `core/node_modules/autobase/index.js:1992-
  1996` (`if (this.writable) return Promise.resolve(true); if
  (!this._writable) this._writable = rrp(); return this._writable.promise`)
  and is resolved at line 1882 (`if (this.writable && this._writable)
  this._writable.resolve(true)`) — leak-free, no listener to remove on
  close. `core/index.js`'s `_runJoin` now uses it when present, falling
  back to the original hand-rolled `base.on('update', check)` wait
  (with `.off()` cleanup already in place) only if it's ever absent under
  a different pinned version.

## Task 5: `_onCandidate` must stay pending until approve()/deny() actually runs

- **Brief assumed:** `_onCandidate` emits `'pairing-request'` and returns;
  `approve()`/`deny()` are called later, out of band, from the event
  listener.
- **Reality (`blind-pairing@2.x`, `core/node_modules/blind-pairing/
  index.js:463-483`):** `Member._addRequest(value)` does
  `promise: this.onadd(request)`, then `await pending.promise`, and only
  *after* that promise settles does it check `if (!pending.request.response)
  return null` before sending anything back over the channel
  (`BlindPairing._onpairingrequest`: `ch.messages[1].send(request.response)`).
  Compare `reference/autopass/index.js:346-362`, where `onadd` is one
  self-contained async function that calls `addWriter` and `candidate.confirm()`
  itself before returning — the autopass reference never splits "decide"
  from "the promise blind-pairing is awaiting."
  Task 4's `_onCandidate`, unchanged, returned immediately after `emit()`
  (a synchronous call whose async listener is not awaited) — so the onadd
  promise resolved a couple of microtasks later, almost certainly *before*
  `approve()`'s multi-await chain (roster lookup → `add-device` append →
  `confirm()`) ever got to call `confirm()`/`deny()`. `Member._addRequest`
  would see `pending.request.response` still empty, drop the pending-
  requests map entry, and send nothing back — silently stranding the
  joiner (`joinGroup()` would hang until superseded, no error surfaced).
- **Resolution:** `_onCandidate` now creates a `decided` promise (resolved
  by a `settle` function stored on the `_pending` map entry) and `await`s
  it as the very last thing before returning. `approve()` and `deny()`
  each call `pending.settle()` immediately after calling
  `confirm()`/`deny()` on the candidate, so the onadd promise held by
  `Member._addRequest` only resolves once `candidate.response` is
  actually populated, and the reply gets sent on the very same incoming
  request message. Verified end-to-end in
  `core/test/05-approve.test.js`: without this fix the approve test's
  `await joiner.joinGroup(invite)` hangs (confirmed while implementing,
  before adding `settle()`/`await decided`); with it, it resolves.
- **Safety checked:** a candidate that is never approved/denied (e.g. a
  test that fires `'pairing-request'` and does nothing) leaves `_onCandidate`
  awaiting `decided` forever, but this is a plain, timer-free `Promise` on
  a detached per-message async handler (`BlindPairing._onpairingrequest`
  is fire-and-forget, not awaited by `Member.close()`'s `this.pairing`/
  `_activePoll` chain, which only tracks the separate DHT-polling path) —
  it neither keeps the event loop alive nor blocks `close()`. Confirmed:
  `core/test/04-pairing.test.js`'s "candidate request reaches the creator"
  test never calls `approve()`/`deny()` and still passes cleanly in the
  full suite.

## Task 5: deny() investigation — blind-pairing DOES reach the candidate

- **Investigated per the controller's Task 5 instructions:** does
  `blind-pairing-core`'s `MemberRequest` (the object passed as `candidate`
  to `Member`'s `onadd`) expose an explicit deny surface that reaches the
  candidate's `'rejected'` event, so a denied joiner's `joinGroup()`
  rejects instead of hanging until superseded?
- **Yes.** `MemberRequest.deny({ status = 1 } = {})`
  (`blind-pairing-core/index.js`) encodes a `ResponsePayload` with a
  non-zero status and sends it exactly like `confirm()` does. On the
  candidate side, `CandidateRequest.handleResponse()` →
  `_openResponse()` sees `status !== 0`, throws `PAIRING_REJECTED()`,
  which `handleResponse`'s catch turns into a `'rejected'` event on
  `candidate.request` — the same surface Task 4 already wired in
  `core/lib/pairer.js` (`candidate.request.on('rejected', (err) =>
  reject(err))`).
- **Resolution:** `deny()` in `core/index.js` calls `pending.candidate.deny()`
  before deleting the pending entry, burning the invite, and settling the
  awaiting `_onCandidate` (see the entry above). `core/test/05-approve.test.js`
  asserts `await t.exception(joiner.joinGroup(invite), ...)` instead of
  the brief's `joinGroupNeverResolves` helper — the denied joiner's
  `joinGroup()` promise genuinely rejects. Verified in the full suite.

## Task 5 (review fix round): undecided candidates were wedging close()

The reviewer empirically reproduced a deadlock the first Task 5 pass's
safety analysis missed: an undecided candidate (`'pairing-request'` fired,
nobody calls `approve()`/`deny()`) makes `core.close()` hang forever.

- **The miss:** the first pass reasoned `_onCandidate`'s awaited `decided`
  promise was only reachable via the *direct-message* path
  (`BlindPairing._onpairingrequest`, fire-and-forget, not part of any
  awaited chain) and concluded it was therefore harmless if left
  unsettled. That's true for *that one path*, but `Member._addRequest` is
  also called from the **DHT-lookup path** —
  `Member._poll()`'s `for await (const data of this._activeQuery) { ...
  await this._add(peer.publicKey, id) ... }` (`blind-pairing/index.js`
  around lines 411/456-470), and `_add()` calls `this._addRequest(node.value)`
  too, which is the SAME `onadd`-awaiting function. Critically, the DHT
  path re-triggers `_addRequest` for a session that's *already* pending in
  `this._pendingRequests` (a candidate republishing to the DHT), re-awaiting
  the SAME held promise. `Member._close()` awaits `_activePoll` (the
  in-flight `_poll()` call) before resolving, `BlindPairing._close()`
  awaits every `member.close()`, and `WallpaperCore._close()` awaits
  `this.pairing.close()` — so an unsettled `decided` promise on the DHT
  path transitively wedges `core.close()` forever.
- **Resolution:** `_close()` now settles (with `new Error('closed')`)
  every entry still in `_pending` — resolving `_onCandidate`'s `await
  decided` — and clears the map, *before* touching `this.pairing`/
  `this.swarm`/`this.base`. `_onCandidate` also now early-returns if
  `this.closing` is already set, so no *new* pending candidate can be
  created once close() has started (it would have no way to be settled).
  Verified with a dedicated regression test
  (`core/test/05-approve.test.js`, "close: an undecided pairing-request
  does not wedge close()") that races `creator.close()` against a 5s
  timeout — it must resolve as `'closed'`, not `'timeout'`.
- **Bonus finding while fixing this — burning an invite didn't actually
  bound it:** `approve()` deleted only *its own* candidate's `_pending`
  entry and burned the invite, but any *other* candidate that had also
  reached `_onCandidate` on the same (now-dead) invite stayed in
  `_pending`, fully approvable, forever (nothing ever settled or denied
  it). Fixed by having `approve()`, right after burning the invite,
  iterate any remaining `_pending` entries, call `candidate.deny()` on
  each (best-effort — a candidate may already be disconnected) and
  `settle()` them, then clear the map. Verified with
  "approve: burning the invite rejects other pending candidates on the
  same invite" — two joiners request against one invite; approving the
  first makes the second's `joinGroup()` reject via the existing
  `'rejected'` plumbing, and only one `add-device` ever lands (roster
  length 2, not 3).
- **Also added:** `deny()` now has the same creator-only roster check
  `approve()` already had (defense in depth, per the global constraint);
  both `approve()`/`deny()` throw `'not in a group'` when `this._pending`
  is `null`, mirroring `createInvite()`'s guard; and both now run their
  body in `try { ... } finally { pending.settle() }` so an append failure
  mid-approve/deny (e.g. base closing concurrently) can never leave the
  awaiting `_onCandidate` stuck — `settle()` always runs exactly once.
- **Test-harness note (unrelated to blind-pairing's API, but worth
  recording):** the new "burning the invite rejects other pending
  candidates" test had to attach a throwaway `.catch(() => {})` to
  `secondPromise` immediately at creation, *in addition to* the later
  `t.exception(secondPromise, ...)` assertion — otherwise Node's
  unhandled-rejection detector can fire (and crash the process) in the
  several-`await`-long window between `deny()` rejecting the promise and
  the test finally asserting on it. Both handlers observe the same
  rejection independently; this is the same pattern already used
  elsewhere in the suite for promises that are deliberately not awaited
  immediately.
