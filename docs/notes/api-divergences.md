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
  Verified with two regression tests in `core/test/05-approve.test.js`,
  both racing `creator.close()` against a 5s timeout (must resolve as
  `'closed'`, not `'timeout'`):
  - "close: an undecided pairing-request does not wedge close()" — the
    straightforward black-box scenario (pairing-request fires, nobody
    decides, close). **Empirically this one does NOT reproduce the bug**:
    checked by temporarily removing the `_close()` drain and re-running —
    it still passed in ~600ms. Root cause: by the time this test calls
    `close()`, `Member._activePoll` is idle (`null`, parked in
    `timeout.wait()`) because the *first* DHT poll (kicked off at `Member`
    creation, back during `createGroup()`) already finished — with
    `DEFAULT_POLL` ~7 minutes, the *second* poll cycle that could
    plausibly overlap our candidate's window never starts within the
    test. `Member._abort()`'s `while (this._activePoll !== null)` is a
    no-op when `_activePoll` is already `null`, so this test alone proves
    nothing about the DHT-path race — it only proves the direct-message
    path stays harmless (already known from the original Task 5 pass).
  - "close: does not wedge on a DHT-poll re-check of an undecided
    candidate" — added after the above negative result, to deterministically
    force the exact hazardous state rather than hope for a network-timing
    race: grabs the joiner's already-encoded wire bytes
    (`joiner._activeJoin.candidate.request.encode()` — the same bytes the
    live connection already sent) and calls `creator.member._addRequest(wireBytes)`
    directly, simulating `Member._poll()`'s `_add()` re-invoking
    `_addRequest` for a session that's already pending. Assigns the
    resulting promise to `member._activePoll` (wrapped in `.finally()` to
    null it back out once settled — mirroring `_run()`'s own contract for
    that field; skipping the `.finally()` reproduced a *different*
    artifact, an infinite busy-loop in `_abort()`'s `while`, once the fix
    made the promise resolve but nothing ever reset `_activePoll` to
    `null` — that's specific to driving the internal field by hand in a
    test, not a real blind-pairing behavior).
    **Confirmed this one DOES reproduce the bug:** with the `_close()`
    drain temporarily removed, this test correctly failed
    (`not ok ... actual: timeout, expected: closed`) rather than hanging
    the runner (the 5s `Promise.race` did its job) — direct proof the fix
    addresses the reviewer's actual repro, not just a lookalike scenario.
    With the fix restored, both tests and the full suite (run twice) are
    green.
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

## Task 6: gate-destroyed connections need an 'error' listener; stranger test has two gatekeepers, not one

- **Brief's `_onConnection`, as given, has no `conn.on('error', ...)`
  handler anywhere** — only `conn.on('close', ...)`. Destroying a live
  Hyperswarm connection (`conn.destroy()`, no error arg) is graceful on
  the *initiating* side, but the far end's `NoiseSecretStream`
  (`@hyperswarm/secret-stream`) can surface it as an `ECONNRESET`-style
  `'error'` event before `'close'` — reproduced deterministically (4/4
  runs) in the brief's own `06-gating.test.js` "stranger" scenario, where
  it crashed the process with `Error: connection reset by peer` /
  `Emitted 'error' event on NoiseSecretStream instance`, because the
  bare `Hyperswarm` client in the test had no listener for it and Node
  throws on an unhandled `'error'` emission. Confirmed by instrumenting
  the stranger's own `conn.on('error', ...)` — it fires every time the
  gate destroys the connection.
  **Resolution:** added `conn.on('error', () => {})` at the top of
  `_onConnection` in `core/index.js` (before the async gate check), so
  every connection any `WallpaperCore` instance touches — gate-rejected,
  revoked, or a genuine network drop — can't crash the process; `'close'`
  remains the sole source of truth for connection bookkeeping. Also added
  the same defensive listener on the raw `Hyperswarm` "stranger" in the
  test itself (test-authored code, not covered by the `index.js` fix).
  The revocation test's destroy (`removeDevice`) did *not* reproduce this
  crash in isolation — likely because that connection had been open and
  actively replicating for a while before being cut, vs. the stranger
  case where the gate destroys a connection within milliseconds of it
  opening; timing right at connection-open appears to be what tips a
  graceful close into a peer-visible reset. Not fully root-caused at the
  UDX/DHT-transport layer; the defensive listener is the appropriate fix
  either way since a real network fault could trigger the same path.
- **Brief's stranger test assumes exactly one gatekeeper (`t.plan(1)`,
  a single `'close'` listener firing once).** Reality: `pairedDuo(t)`
  leaves *two* members' swarms joined to the group's discovery key
  (creator and joiner), both independently discover the stranger via the
  DHT and both independently gate it out — so the stranger observes two
  separate connections, each destroyed. Running the brief's test verbatim
  (after fixing the error-listener crash) produced `t.plan(1)` violations
  (`Assertion after end`) from the second `'close'`. **Resolution:**
  rewrote the assertion to count closes and expect exactly 2
  (`expectedGatekeepers = 2`), documented inline in
  `core/test/06-gating.test.js`, preserving the test's intent (every
  rostered member's gate rejects a stranger) rather than the brief's
  undercount.

## Task 9: hyperblobs/hypercore `{ timeout }` shape confirmed; brief's `_materialize` has a same-entry concurrency race

- **Checked installed `hyperblobs@2.8.0` and `hypercore` source** per the
  controller's instruction. `Hyperblobs.get(id, opts)` forwards `opts`
  straight through: the single-block fast path calls
  `this.core.get(id.blockOffset, opts)` directly (no try/catch), and the
  multi-block path's `createReadStream(id, opts)` also threads `opts` down
  to the underlying `core.get`/session calls. `hypercore/index.js` reads
  `opts.timeout` (`core/node_modules/hypercore/index.js:823-824`,
  `:966-967`): `if (timeout) req.context.setTimeout(req, timeout)`, and a
  fired timeout rejects with `HypercoreError.REQUEST_TIMEOUT()` (code
  `REQUEST_TIMEOUT`, `hypercore-errors/index.js:68`) — not
  `BLOCK_NOT_AVAILABLE`, so `Hyperblobs.get`'s multi-block try/catch (which
  only swallows `BLOCK_NOT_AVAILABLE`) rethrows it, and the single-block
  path was never wrapped at all. **No divergence**: `{ timeout: timeoutMs }`
  is exactly the right shape, and a bounded `blobs.get()` call genuinely
  rejects on timeout as the brief assumed ("rejection = stays pending,
  retried next update"). Implemented in `core/lib/blobs.js`'s `get(ref,
  { timeoutMs = 0 } = {})` verbatim per the brief.
- **Bug found in the brief's own `_materialize` snippet, fixed (not an API
  drift, but recorded here per the task's divergence-logging instruction):**
  `pendingWallpaper()` calls `_materialize(entry)` directly, bypassing the
  `_applyBusy` guard that serializes `_checkIncoming`'s calls. In
  `core/test/09-receive.test.js`'s "pendingWallpaper pulls the same entry"
  test, `until()`'s poll loop calls `joiner.pendingWallpaper()` on the same
  entry the `update`-triggered `_checkIncoming()` is *also* materializing
  concurrently — both instances of `_materialize` compute the same
  `tmpPath` (`filePath + '.part'`), both `writeFile` it, and the first
  `rename()` wins while the second throws `ENOENT` (its `.part` is already
  gone), crashing the process (empirically reproduced running the brief's
  code verbatim). **Resolution:** `_materialize` now dedupes on
  `entry.id` via a `this._materializing` Map of in-flight promises — a
  second concurrent call for the same id awaits the first call's promise
  instead of starting its own fetch+write. The actual fetch+write body
  moved unchanged into a new `_materializeNow(entry, filePath)`. Verified:
  removing the dedupe reproduces the `ENOENT` crash deterministically on
  every run of the affected test; with it, the full suite (27/27) is green
  on repeated runs.

## Task 2 (android-shell): bare-expo template needed two real Gradle/AGP
fixes to boot on the emulator; two smaller sketch divergences

The brief's Step 4 go/no-go gate (`npx expo run:android`) failed twice on
first boot, on this environment's Android Studio JBR (JDK 25) paired with
the Gradle/AGP versions this Expo SDK 55 / RN 0.83.6 release resolves.
Both are genuine upstream compatibility bugs, not something wrong with the
scaffold itself — recorded here in full since they gate the whole plan.

- **Bug 1 — `foojay-resolver-convention@0.5.0` (pinned inside
  `node_modules/@react-native/gradle-plugin/settings.gradle.kts`, an
  included composite build) throws `NoSuchFieldError` against Gradle
  9.0.0** (the version this template's own CNG pins in
  `android/gradle/wrapper/gradle-wrapper.properties`):
  `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
  'IBM_SEMERU'` inside `org.gradle.toolchains.foojay.DistributionsKt.<clinit>`.
  Gradle 9 removed a field that plugin's 0.5.0 release (current in 2023,
  long predating Gradle 9's mid-2025 GA) was compiled against. Confirmed
  by checking Maven metadata for the plugin's Gradle Plugin Portal
  coordinates — releases up to 1.0.0 exist, all newer than what
  react-native@0.83.6 ships.
  **Resolution:** `patches/@react-native+gradle-plugin+0.83.6.patch`
  (via `patch-package`, `postinstall` script added to `package.json`)
  bumps that one version string to `1.0.0`. Verified the patch reapplies
  automatically on a clean `npm install` (postinstall ran, `settings.gradle.kts`
  came back patched).
- **Bug 2 — AGP 9.5.0-alpha02 (the version this project's Expo/RN version
  catalog resolves to pair with Gradle 9.0.0; confirmed no matching stable
  AGP release exists — AGP 9.3.1, the latest stable, hard-requires Gradle
  >= 9.5.0, so downgrading AGP without also bumping the Gradle wrapper
  isn't a real option) misclassifies a JDK startup banner as a fatal
  prefab/CMake build error.** `expo-modules-core` and `react-native-screens`
  both fail at `:<module>:configureCMakeDebug[arm64-v8a]` with
  `IllegalStateException: WARNING: A restricted method in java.lang.System
  has been called`. Root-caused by disassembling
  `com.android.build.gradle.tasks.GeneratePrefabPackagesKt` (via `javap`
  on the cached AGP jar): its `reportErrors`/`errorMatchers` logic reads
  the prefab subprocess's captured stderr file line-by-line, and any line
  that doesn't match one of a handful of known prefab-specific regexes
  (and isn't blank) is unconditionally treated as an `OtherError` and
  thrown as fatal. The JBR bundled with Android Studio (JDK 25, mandated
  as `JAVA_HOME` for this task) runs the prefab subprocess (same JVM,
  since AGP resolves it via `Jvm.current()`) and JDK 25 prints JEP 472's
  "restricted native access" warning on that subprocess's first native
  call — an unrecognized, unmatched line that AGP's parser fatals on.
  **A pure JVM-flag fix is a dead end:** every mechanism for silencing the
  warning (`JDK_JAVA_OPTIONS`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`) itself
  unconditionally prints a `NOTE: Picked up ...` banner to the same
  stderr stream, which trips the identical `OtherError` fallthrough —
  confirmed empirically (swapped one fatal line for the other, build still
  failed the same way). There is also no second JDK anywhere on this
  machine to fall back to (checked `/Library/Java/JavaVirtualMachines`,
  `~/.jdks`, Homebrew, `/usr/libexec/java_home`) — the JBR is the only
  runtime installed.
  **Resolution:** used Gradle 9's Daemon JVM criteria feature
  (`./gradlew updateDaemonJvm --jvm-version=21 --jvm-vendor=adoptium`) to
  make the Gradle *daemon itself* — not just JAVA_HOME's client launcher —
  run under an auto-provisioned JDK 21, which predates JEP 472 and never
  emits the warning. This needs a toolchain-download resolver configured
  at the *root* project (the included builds' own resolvers don't count;
  `updateDaemonJvm` first failed with "Toolchain download repositories
  have not been configured" until the root `settings.gradle` also got the
  foojay plugin). Both `android/settings.gradle` (adds
  `org.gradle.toolchains.foojay-resolver-convention` v1.0.0 — same fixed
  version as Bug 1) and `android/gradle/gradle-daemon-jvm.properties`
  (requesting JDK 21/Adoptium, with the foojay redirect URLs baked in
  exactly as `updateDaemonJvm` generated them) are CNG-regenerated,
  gitignored output, so a fresh `expo prebuild`/`expo run:android` would
  silently lose this fix on a clean clone. Wrote a small local Expo config
  plugin, `android/plugins/withGradleJvmFix.js` (registered in
  `app.json`'s `plugins`), that re-applies both on every prebuild via
  `withSettingsGradle` and `withDangerousMod('android', ...)`. Verified by
  deleting `android/android` + `android/ios` + `android/.expo` entirely,
  re-running `npx expo prebuild --platform android`, confirming both files
  came back correct without any manual step, then running a full
  `npx expo run:android` from that clean state end to end: `BUILD
  SUCCESSFUL`, echo screen rendered on the emulator, worklet console
  output visible in logcat.
- **Sketch divergence — `adb logcat -s bare` doesn't show the worklet's
  `console.log` output.** The brief's Step 4 verification named tag `bare`
  verbatim. On this react-native-bare-kit@0.15.0 build, the worklet's
  `console.log('Hello from React Native!')` actually surfaces in logcat
  under the app's own (truncated) package tag —
  `I/arwallpaper.app: Hello from React Native!` (from
  `com.pearwallpaper.app`, Android truncates long tags) — not under a tag
  literally named `bare`. Confirmed no logcat line anywhere is tagged
  exactly `bare` (`adb logcat -v tag | grep -i bare` — no hits beyond the
  package-tag one). Verification for this and future tasks should grep
  full logcat (or filter on the app's own package/PID) for the expected
  worklet output rather than `-s bare`.
- **Sketch divergence — `@testing-library/react-native@14.0.1`'s `render()`
  is `async`, not sync.** The brief's Step 5 sketch
  (`const { toJSON } = render(<Screen />)`) matches older
  testing-library versions; 14.x's `render` returns a `Promise` (it now
  awaits React's `act()` internally), so destructuring `toJSON` off the
  unresolved promise threw `TypeError: toJSON is not a function`.
  `test/smoke.test.js`'s test is `async` and does
  `const { toJSON } = await render(<Screen />)`.

## Task 2 review fix: pin sweep was incomplete first pass

The first pass only pinned `react-native-bare-kit` exact, leaving the
brief's global "no `^`/`~`" constraint unapplied to everything else
`bare-expo` installed with ranges (`b4a`, `expo`, `expo-build-properties`,
`expo-constants`, `expo-linking`, `expo-router`, `expo-system-ui`,
`react-native-b4a`, `react-native-safe-area-context`,
`react-native-screens`, `@types/react`, `prettier`,
`prettier-config-holepunch`, `typescript`) — an undisclosed spec gap
caught in review, not a newly-discovered API divergence. Fixed by pinning
every `android/package.json` dependency/devDependency to the version
already resolved in `package-lock.json`, then regenerating the lockfile
(`npm install`) and confirming `npm ci` installs cleanly from it — see
the fix report appended to `task-2-report.md` for the exact versions and
verification output.

## Task 3: jest picks up brittle's test-worklet/*.test.js too

Not named in the brief. `android/test-worklet/host.test.js` uses
`require('brittle')`/`test(name, fn)`, run via the new `test:worklet`
script (`brittle test-worklet/*.test.js`). But jest's default
`testMatch` (`**/?(*.)+(spec|test).[tj]s?(x)`) also matches that same
file path, and `npm run test:ui` (`jest`) picked it up and tried to run
it as a jest suite — it failed immediately with `Cannot find module
'@babel/runtime/helpers/interopRequireDefault' from '../core/index.js'`
(jest-expo's babel-jest transform pipeline doesn't apply cleanly to
`pear-wallpaper-core`'s plain CJS, which is meant to run under Node/Bare
directly, not through Metro/Babel). Fixed by adding
`testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test-worklet/']`
to `android/jest.config.js` (the explicit `/node_modules/` entry is
jest's own default, restated because setting the option at all replaces
it rather than appending). Verified both `npm run test:worklet` (1/1,
4/4 asserts) and `npm run test:ui` (1/1) green in the same tree
afterward.

## Task 3: bare-pack version — no established pin to match

Unlike `brittle`/`test-tmp` (matched desktop's `3.19.1`/`1.4.0` via
`npm ls`), `bare-pack` isn't a dependency anywhere else in this repo
(desktop bundles nothing — it runs its Bare worker straight off disk via
pear-runtime's sidecar) and `react-native-bare-kit@0.15.0` itself depends
on `bare-link`, not `bare-pack`, for its own native-module linking, so
there was no precedent version to copy. Pinned to `bare-pack@2.2.1`, the
current npm `latest` at the time of this task (`npm view bare-pack
version`).

## Task 3: `--linked` bundling worked with no extra flags for the `file:` symlinked deps

The brief flagged this as a thing to watch for ("record divergences if
bare-pack needs flags for symlinked deps"). It didn't: `bare-pack
--linked --host android-arm64 --host android-x64 --out
app/gen/worklet.bundle.mjs worklet/core-host.js` resolved
`pear-wallpaper-core`/`pear-wallpaper-bridge` straight through their
`file:../core` / `file:../bridge` npm symlinks with no special flag —
the bundle's JSON header's `resolutions` map is full of
`/node_modules/pear-wallpaper-core/...` and
`/node_modules/pear-wallpaper-bridge/...` paths, `bare-module-traverse`
evidently follows symlinks transparently. `--linked` rewrote every
native addon's self-`require` (the `.` resolution on each addon's
`binding.js`) from a bundled binary to a `linked:lib<name>.<version>.so`
specifier — confirmed for both native modules the brief calls out
(`"linked:libsodium-native.5.1.0.so"`, `"linked:libudx-native.1.21.0.so"`)
and, incidentally, 9 more native deps pulled in transitively
(`bare-fs`, `bare-inspect`, `bare-path`, `bare-type`, `bare-url`,
`fs-native-extensions`, `quickbit-native`, `rocksdb-native`,
`simdle-native`) — 11 `linked:` specifiers / 32 occurrences total in the
2.2MB output. These `.so`s are supplied at runtime by BareKit's own
linked-modules mechanism per the `--host` targets given
(`android-arm64`, `android-x64`), not embedded in the bundle — that's
the point of `--linked` for a mobile target.

## Task 4: bare-pack's `.bundle.mjs` output is a plain default-export string

The template echo screen (`android/app/index.js` pre-Task-4) never
imported a generated bundle — it inlined a literal source string and
called `worklet.start('/app.js', source)` directly. `bare-pack`'s CLI
`--out .../worklet.bundle.mjs` (`bundle:worklet` script) instead produces
`export default "<len>\n{...json bundle...}"` (confirmed by reading the
generated file directly, and by `bare-pack`'s README "bundle format"
table: `bundle.mjs` → `.bundle.mjs` → "ES module wrapper for a
`.bundle`"). So `lib/worklet-client.js` does
`import bundle from '../app/gen/worklet.bundle.mjs'` and calls
`worklet.start('/worklet.bundle', bundle)` — same `Worklet#start(path,
source)` shape as the template, just with a generated string instead of
a literal one. Metro's default `sourceExts` already includes `mjs`
(confirmed via `getDefaultConfig(__dirname).resolver.sourceExts`), so no
metro.config.js change was needed for the app build. Jest needed one,
though: jest-expo's preset only wires `babel-jest` for `\.[jt]sx?$`
(confirmed via `require('jest-expo/jest-preset').transform`), which does
not match `.mjs` — both the bundle import and `pear-wallpaper-bridge/ui`
(`bridge-ui.mjs`, real ESM `export function` syntax) hit `SyntaxError:
Unexpected token 'export'` under jest without it. Fixed by adding
`transform: { '\\.mjs$': 'babel-jest' }` to `android/jest.config.js`
alongside the preset (jest merges preset + local `transform` maps, so
this adds a matcher rather than replacing the preset's four).

## Task 4: expo-file-system's `documentDirectory` string constant is gone; `Paths.document.uri` is a `file://` URI, not a plain path

The brief's own note ("SDK 54+ renamed `documentDirectory` → `Paths.document`")
undersold the change: it isn't a rename, the new `Paths.document` is a
`Directory` instance whose `.uri` getter returns a `file://` URI string
(confirmed from the installed package's Android native source,
`expo-file-system/android/.../FileSystemModule.kt`: `Constant
("documentDirectory") { Uri.fromFile(context.filesDir).toString() + "/" }`
— e.g. `file:///data/user/0/com.pearwallpaper.app/files/`). The
worklet's corestore (`core/index.js`: `new Corestore(storageDir +
'/corestore')`, opened by Bare's own `fs`/`rocksdb-native`) wants a plain
filesystem path, the same shape desktop passes via
`app.getPath('userData')` — a `file://`-prefixed string is not a valid
path there. `lib/worklet-client.js`'s `documentsPath()` strips the
`file://` scheme and any trailing slash with a plain string replace
(`Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '')`)
rather than pulling in a URL polyfill for this one substitution.
Old-style `expo-file-system` legacy functions (`getInfoAsync`, etc.) are
still exported from the package root but throw at runtime per their own
`@deprecated ... This method will throw in runtime` JSDoc — only the new
`File`/`Directory`/`Paths` API is usable at all under this SDK.

**Update (Task 4 review fix, same day):** `expo-file-system` was
originally left undeclared in `android/package.json` — only `expo-device`
was added, per the brief's literal file list — relying on `expo@55.0.23`'s
own internal `expo-file-system@~55.0.19` dependency to hoist it into
`node_modules/expo-file-system`. Review correctly flagged this as fragile
(`lib/worklet-client.js` imports it directly; if `expo` ever stopped
depending on it, or a hoisting quirk put a second copy elsewhere, the
import breaks with no `package.json` signal explaining why). Fixed by
`npx expo install expo-file-system` (SDK-compatible resolution picked
`55.0.25`, newer than the `55.0.19` that had been transitively hoisted —
`npm ls expo-file-system` confirms a single deduped copy shared by both
`expo` and this app's own direct dependency, so there's exactly one
`expo-file-system` in the tree, not two diverging ones), then pinned exact
(`"expo-file-system": "55.0.25"`, no `~`) same as every other
Expo-managed package in this file. `npm ci` installs cleanly from the
regenerated lockfile; `npm run test:ui` stayed green (11/11) — the
`55.0.19` → `55.0.25` bump is a patch-level release within the same
Expo SDK compatibility window, and the only surface this code touches
(`Paths.document.uri`, a getter on the stable `Directory` class) is
unchanged. No emulator rebuild was done for this fix: the installed
`expo-file-system` code was already present and being exercised via the
transitive path during the original on-device verification (Act 1 in
`docs/notes/qa-android.md`) — this change only adds the missing
`package.json`/lockfile declaration and bumps the resolved patch version,
it does not change which code runs differently than what was already
verified in a way relevant to this integration point.

## Task 5 (android-shell): expo-camera API matched the brief exactly

- **Checked against installed `expo-camera@55.0.22`** (`node_modules/expo-camera/build/*.d.ts`,
  installed via `npx expo install expo-camera` then pinned exact, no `~`).
  `useCameraPermissions(options?)` returns a 3-tuple
  `[PermissionResponse | null, requestPermissionAsync, getPermissionAsync]`
  (`PermissionResponse = { status: 'granted'|'undetermined'|'denied',
  expires, granted: boolean, canAskAgain: boolean }`) — the brief's
  "`useCameraPermissions` + request-on-mount" is a correct, if partial,
  description; only the tuple's first two elements are used here.
  `CameraView`'s `onBarcodeScanned?: (result: BarcodeScanningResult) =>
  void` is called directly with the result object (`{ type, data, ... }`),
  not wrapped in a `{ nativeEvent }` envelope (that shape exists
  internally in `CameraNativeProps` but isn't what the public JSX prop
  receives) — so `onBarcodeScanned({ data })` destructuring in
  `ScanInvite.js` needed no adapter. `barcodeScannerSettings:
  { barcodeTypes: ['qr'] }` matches the installed type exactly. No code
  changes were needed beyond what the brief specified.
- **`app.json` plugin config**: `expo-camera`'s config plugin
  (`plugin/build/withCamera.js`) accepts `{ cameraPermission,
  microphonePermission, recordAudioAndroid = true, barcodeScannerEnabled
  = true }` and auto-adds `android.permission.CAMERA` (+
  `RECORD_AUDIO` unless `recordAudioAndroid: false`) to the manifest —
  no manual `android.permissions` array entry needed (contrast Task 6's
  `SET_WALLPAPER`, which isn't plugin-managed and does need one). Set
  `recordAudioAndroid: false` here since QR scanning never touches the
  microphone.

## Task 5 (android-shell): blind-pairing's coded-error `Error#message` format broke both shells' friendly-message lookups

- **Not an expo-camera divergence — a `core`/`blind-pairing-core` one,
  surfaced only now because this was the first real on-device exercise of
  a live `joinGroup()` rejection with an actual DHT round trip (prior QA
  used the REPL, `docs/notes/qa-pairing.md`, or never actually asserted
  the rendered copy).** `blind-pairing-core/lib/errors.js`'s
  `PairingError` constructor does `super(`${code}: ${msg}`)` — so
  `PAIRING_REJECTED`'s `Error#message` is the literal string
  `'PAIRING_REJECTED: Pairing was rejected'`, not the bare code
  `'PAIRING_REJECTED'`. `.code` carries the bare value, but
  `bridge-main`'s command-rejection handler
  (`transport.send({ ..., error: err.message })`) only ever relays
  `.message` across the wire — `.code` never reaches either shell's UI.
  Both `android/components/{Onboarding,Waiting}.js`'s friendly-message
  tables did an exact-match object lookup keyed by the bare code
  (`MESSAGES[err.message]`), which therefore never matched
  `PAIRING_REJECTED`/`INVITE_USED`/`INVITE_EXPIRED` in practice — every
  coded rejection silently fell through to the generic "Could not join.
  Ask for a fresh invite." fallback instead of its specific copy.
  **Fixed on Android** (this task's scope) by matching on
  `message.startsWith(code)` instead of exact equality — still an exact
  match for the plain (uncoded) `'superseded by a newer invite'`/`'closed'`
  messages, since a full-string match is trivially also a prefix match.
  Verified live: a scripted desktop peer's `deny()` now renders "The
  creator denied this device." on `Waiting`, confirmed by screenshot
  (`docs/notes/qa-android.md` Act 2). **`desktop/ui/components/
  {Onboarding,Waiting}.js` have the identical exact-match bug** (same
  `JOIN_ERROR_MESSAGES`/`MESSAGES` pattern, same code) — left unfixed
  there, out of this task's scope; flagging for whoever next touches
  desktop's pairing UX.
