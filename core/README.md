# `core/` — WallpaperCore API

The complete shell-facing surface of the P2P wallpaper engine. Plain
CommonJS, runs identically on Node and Bare. This is the frozen
contract Plan 2 (desktop) and Plan 3 (Android) build against — shells
never touch hypercore/autobase/hyperswarm/hyperblobs/blind-pairing
directly, only this API.

Signatures below are copied from `core/index.js` as built (not from
the design spec, where they've since drifted — see "Delta from spec
§3.1" at the end of this file).

```js
const WallpaperCore = require('pear-wallpaper-core')
const core = new WallpaperCore({ storageDir, deviceName })
await core.ready()
```

## Lifecycle & identity

- **`new WallpaperCore({ storageDir, deviceName, bootstrap = null })`**
  Constructor. `storageDir` and `deviceName` are required (throws
  `'storageDir and deviceName are required'` otherwise). `bootstrap`
  is a Hyperswarm/HyperDHT bootstrap list — leave it `null` in
  production (uses the public DHT); tests pass a local testnet's
  bootstrap nodes so runs don't touch the network. `core.storageDir`
  and `core.deviceName` are readable afterwards as plain properties.

- **`await core.ready(): Promise<void>`**
  Opens storage, derives this device's identity, and — if this device
  already belongs to a group (persisted from a previous run) — reboots
  the autobase, blob store, and swarm, resuming a pending `joinGroup`
  if one was in flight when the process last exited. Call once, at
  startup, before touching anything else.

- **`await core.close(): Promise<void>`**
  Tears down swarm, pairing, autobase, and storage cleanly. Idempotent
  and safe to call from a `finally`/teardown.

- **`core.deviceKey: string`** (hex)
  This device's identity — the autobase local-writer key, the same key
  that appears in the roster and in send targets. Set once `ready()`
  resolves.

- **`core.groupStatus: 'none' | 'joining' | 'member'`**
  `'member'` once this device has a live autobase (creator or joined);
  `'joining'` while a `joinGroup()` invite redemption is in flight
  (including one resumed automatically on restart); `'none'`
  otherwise. Route shell UI (onboarding vs. main) off this.

## Group formation & pairing

- **`await core.createGroup(): Promise<void>`**
  Bootstraps a new autobase with this device as creator and sole
  roster entry. Throws `'already in a group (or joining one)'` if
  called again.

- **`await core.createInvite(): Promise<string>`**
  Mints a single-use, 24h-expiring invite string (z32-encoded,
  QR-able). Creator-only — throws `'only the creator can invite'`
  otherwise, or `'not in a group'` with no group. Calling it again
  while an invite is still live returns the *same* invite string
  rather than minting a second one. If the outstanding invite has
  instead expired unredeemed, calling it burns the dead invite and
  mints a genuinely fresh one — an expired invite is never re-served
  (spec §6: the only remedy for an expired invite is a new one).

- **`await core.joinGroup(invite: string): Promise<void>`**
  Redeems an invite and resolves once a human on the creator's device
  calls `approve()` and this device's roster entry has synced. Throws
  `'already in a group'` if this device already has one. A second
  call with the *same* invite string returns the original in-flight
  promise; a call with a *different* invite supersedes (rejects) the
  stale attempt first. Automatically resumed on restart if the process
  exited mid-join (persisted in local metadata) — no explicit resume
  call needed.

  The returned promise can also *reject*. Build the "waiting for
  approval" screen against these cases:
  - **`PAIRING_REJECTED`** (blind-pairing coded error) — the creator
    called `deny()`.
  - **`INVITE_USED`** (blind-pairing coded error) — the invite was
    already redeemed (single-use) by another candidate.
  - **`INVITE_EXPIRED`** (blind-pairing coded error) — the invite's
    24h window had already passed when it reached the creator.
  - **`'superseded by a newer invite'`** — this call was displaced by
    a *later* `joinGroup(otherInvite)` call on the same instance
    before it resolved.
  - **`'closed'`** — `close()` ran while this join was still pending.
    Not a failure: the persisted pending invite is kept, and the next
    `ready()` resumes the join, so a quit while waiting for approval
    picks up where it left off.

- **`core.on('pairing-request', ({ candidateKey, name }) => …)`**
  Fires on the creator's device when a candidate redeems a live
  invite. `candidateKey` is the value to pass to `approve()`/`deny()`.

- **`await core.approve(candidateKey): Promise<void>`** /
  **`await core.deny(candidateKey): Promise<void>`**
  The human authorization gate. `approve()` writes `add-device` and
  admits the candidate; `deny()` refuses and burns the invite (it's
  single-use either way — a denied invite can't be retried by the same
  or any other candidate). Checks, in order: throws `'not in a group'`
  if this device has no group at all; throws `'no pending candidate
  with that key'` if `candidateKey` isn't currently pending (checked
  before the creator check below, so a non-creator caller with a
  bogus key sees this, not the creator-gate error); then, creator-only
  — throws `'only the creator can approve'`/`'...deny'` for a
  non-creator caller.

## Roster

- **`await core.listDevices(): Promise<Array<{ key, name, isSelf, isCreator, online }>>`**
  Datasource for the send-target picker and device management. `[]`
  before this device has joined/created a group. `isCreator` is
  derived from the log (the first-ever `add-device` author), never
  self-reported by the device row. `online` is true for this device
  itself, and for another device while this device holds a swarm
  connection to it.

- **`await core.removeDevice(key: string): Promise<void>`**
  Revocation. Creator-only — throws `'only the creator can remove
  devices'` otherwise, `'cannot remove self'` for the creator's own
  key, `'unknown device'` for a key not on the roster, `'not in a
  group'` with no group.

- **`core.on('roster-changed', () => …)`**
  Fires when the device set changes (join/removal), and also on every
  gate-allowed connection opening or closing — which is a wider set
  than just rostered devices' online/offline flips: a pairing
  candidate connecting during an open, unexpired invite window passes
  the same gate and fires this event too, even though it isn't (yet)
  on the roster. Keeps device-list UIs current without polling; a
  handler that only cares about roster online/offline should re-derive
  that from `listDevices()`'s `online` field rather than assume every
  firing means a rostered device changed state.

## Sending

- **`await core.sendWallpaper(image: string | Buffer, targets: string[], { filename?: string | null } = {}): Promise<{ id: string }>`**
  Validates the image (JPEG/PNG/WebP by magic bytes, 20 MB cap — throws
  `'unsupported image format (JPEG, PNG, WebP only)'` or `'image
  exceeds 20 MB cap'`), stores it in this device's blob store, appends
  `set-wallpaper`, and resolves immediately — queued-delivery
  semantics, it never waits on any target. `image` as a string is read
  from disk via `fs.promises.readFile`. Every entry in `targets` must
  already be on the roster or the whole call throws `` `target ${key}
  is not in the roster` `` before anything is appended. Throws `'not
  in a group'` with no group, `'targets required'` for an empty/non-
  array `targets`. `filename` is the display name recorded in
  `meta.filename`; `null` records none, and leaving it out lets a
  string `image` supply its own name. Only the last path segment is
  kept, because `meta` replicates to every member and a local path
  would leak folder and user names.

- **`await core.listSends({ limit = 20 } = {}): Promise<Array<{ id, meta, sentAt, targets: [{ key, status: 'pending' | 'delivered' | 'superseded' }] }>>`**
  This device's sent history, newest first (by log order, not
  `sentAt`), backing the per-target delivered-✓ UI. `[]` with no
  group. See "Target status vocabulary" below for what each status
  means.

- **`core.on('send-updated', ({ id }) => …)`**
  Fires once, on this device, when one of *its own* sends picks up a
  new `applied` ack from a target — pushes delivery-status flips so
  the UI doesn't need to poll `listSends()`.

### Target status vocabulary

- **`pending`** — no `applied` ack from that target yet, and no newer
  send to that target has been acked either.
- **`delivered`** — that target has appended an `applied` ack for
  *this* send.
- **`superseded`** *(derived, not a stored ack — a computed read-time
  status)* — that target never acked this send, but it *did* ack a
  *later* send addressed to it. Because a device only ever applies the
  newest send targeting it, this send will never be delivered; it's
  reported as `superseded` rather than staying `pending` forever.

## Receiving

- **`core.on('wallpaper', ({ id, filePath, fromKey, meta }) => …)`**
  Fires only once the newest unapplied wallpaper targeting this device
  is fully fetched and written to `filePath` on local disk — no
  partial-data cases (atomic `.part`-then-rename, see "Storage
  layout"). "Fetched" here means hypercore's own block-hash
  verification passed during replication (bytes cannot silently
  corrupt in transit); it is *not* a re-run of the JPEG/PNG/WebP
  format sniff on receipt — that check happens once, on the sender's
  side, inside `sendWallpaper()`, before the bytes ever get appended.
  This is the shell's trigger to run the OS setter. `meta` is `{ ext,
  byteLength, filename }`, computed by `sendWallpaper()` from the
  image it was given (`ext` from the format sniff, `byteLength` from
  the buffer, `filename` the basename of the `filename` option or of a
  path-string `image`, else `null`) — the caller never passes `meta`
  directly. Groups created before this rule may still hold full paths
  in `filename`, so shells basename it again before display.

- **`await core.pendingWallpaper(): Promise<{ id, filePath, fromKey, meta } | null>`**
  Pull-based twin of the `'wallpaper'` event, for shells that wake up
  late (e.g. after a background sync) and need to check for work
  without racing to attach a listener first. Fetches/materializes the
  blob the same way the event path does if it isn't on disk yet. `null`
  if nothing is pending (including with no group).

- **`await core.markApplied(id: string): Promise<void>`**
  The shell's confirmation that the OS setter succeeded for send `id`.
  Appends the `applied` ack — the *only* place that ack is written.
  Skipping this after a failed setter run is correct: the send stays
  queued and is retried (re-emitted/re-returned by `pendingWallpaper`)
  on the next sync rather than silently vanishing. Throws `'not in a
  group'`, `'unknown send'`, or `'not a target of this send'`.

- **`await core.listReceived({ limit = 10 } = {}): Promise<Array<{ id, fromKey, meta, filePath, appliedAt }>>`**
  Local history of wallpapers this device has applied, newest first —
  powers re-apply (shell re-runs its setter against the stored
  `filePath`; no network traffic). `[]` with no group.

## Sync control

- **`await core.sync({ timeoutMs = 30000 } = {}): Promise<void>`**
  Bounded "connect, exchange with reachable peers, settle" round:
  flushes the swarm's pending connections, ingests whatever connected
  peers have, relays any un-acked blobs this device is holding for
  others, and checks for newly-arrived wallpapers addressed to this
  device. Always resolves (never rejects) at or before `timeoutMs`,
  even on a stalled/absent peer — this is what Android's periodic
  background task calls; desktops generally don't need it since
  `ready()` leaves them continuously connected and event-driven.

## Other events

- **`core.on('update', () => …)`** — fires on every autobase log
  update (a strict superset of `roster-changed`/`send-updated`/
  `wallpaper` — those are derived from it). Most UIs should prefer the
  scoped events above; `'update'` is there for callers (including this
  package's own tests) that want a raw "something changed, re-check"
  signal.
- **`core.on('error-joining', () => …)`** — fires if a `joinGroup()`
  resumed automatically on restart (from a persisted pending invite)
  fails. There's no payload; the invite is dead either way and the
  recovery is always a fresh one from the creator.

## Shell lifecycle recipes

**Desktop** (continuously running, e.g. a Pear app):

```js
const core = new WallpaperCore({ storageDir, deviceName })
await core.ready()                     // once, at startup
core.on('wallpaper', async ({ id, filePath }) => {
  await runOsSetter(filePath)          // e.g. osascript / SystemParametersInfo
  await core.markApplied(id)           // only after the setter actually succeeded
})
core.on('pairing-request', ({ candidateKey, name }) => showApprovalUi(candidateKey, name))
core.on('roster-changed', () => refreshDeviceList())
core.on('send-updated', ({ id }) => refreshSendStatus(id))
// core stays open and connected; call core.close() on app quit.
```

**Android** (periodic background task, process may not stay resident):

```js
const core = new WallpaperCore({ storageDir, deviceName })
await core.ready()
await core.sync({ timeoutMs: 30000 })
const pending = await core.pendingWallpaper()
if (pending) {
  const ok = await runOsSetter(pending.filePath)   // WallpaperManager.setBitmap()
  if (ok) await core.markApplied(pending.id)       // failure: leave unacked, retried next sync
}
await core.close()
```

## Storage layout

Everything lives under the `storageDir` passed to the constructor:

- **`<storageDir>/corestore/`** — the Corestore root: the device's
  keypair, the autobase log core(s) and its Hyperbee view, this
  device's Hyperblobs core, and a small local-only Hyperbee
  (`local-meta`, a named core inside the same corestore — not a
  separate directory) holding group membership info and any
  in-flight `pending-invite` record used to resume `joinGroup()`
  after a restart.
- **`<storageDir>/received/`** — materialized wallpaper files, named
  `<sendId><ext>` (e.g. `<sendId>.png`), written atomically (`.part`
  then renamed) so a shell watching the directory never observes a
  partial file. This is the `filePath` handed back by the `'wallpaper'`
  event and `pendingWallpaper()`.

Both directories are safe to lose independently of the other only in
the trivial sense that losing either loses the device's ability to
function as that device — losing `corestore/` loses the device's
keypair and log state entirely (spec §6: the device must re-pair as a
new device); losing `received/` just means old wallpapers must be
re-fetched from a peer that still has the blob.

## Security model

Every device is a public-key identity — the autobase local-writer key
returned as `deviceKey`. Group membership (the roster) and invite
issuance are creator-only, and that policy is enforced inside
`apply()` itself against the **verified** author of each log entry
(the writer key autobase attaches to the node, not any self-reported
field in the operation) — a compromised or malicious member can append
whatever `add-device`/`remove-device`/`add-invite`/`del-invite` ops it
likes, but every honest peer's `apply()` ignores ones not authored by
the creator, so the forged op has no effect anywhere in the group. The
two per-device operations are bound to their author the same way:
`apply()` drops a `set-wallpaper` whose `from` isn't the verified author
(no spoofing who a wallpaper came from) and an `applied` ack for any
device other than the author (no acking a peer's delivery on its
behalf, which would permanently suppress that delivery and show the
sender a false ✓).
Connections are gated the same way at the network layer: a Hyperswarm
connection from a public key not on the roster is dropped, unless an
invite is currently outstanding and unexpired or this device hasn't
booted a group yet (still pairing itself in). Note what that exemption
does and does not buy: an invite-window peer keeps a *socket* — which is
all blind-pairing needs, since it rides its own protomux channel — but
gets no `store.replicate`, so it can read neither the view nor any
wallpaper blob. That connection is upgraded to full replication only
once its key actually lands on the roster, i.e. after `approve()`.
Without that split, any outsider holding the discovery key (or a
revoked ex-member, who still has the group's encryption key and
possibly a blob ref) could read everything for the life of the
invite. An
invite is a single-use, 24-hour-expiring blind-pairing capability, and
redeeming one is not by itself sufficient to join — a human on the
creator's device must explicitly `approve()` (or `deny()`) the
resulting `'pairing-request'`; there is no auto-admit. `removeDevice()`
revocation stops all *future* access — the removed device's next
connection attempt is refused at the handshake — but it cannot retract
data the device already replicated while it was still on the roster.
P2P revocation cannot unsee the past.

## Delta from spec §3.1

The design spec's locked API (`docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md`
§3.1) predates several implementation-driven refinements; this file
reflects the as-built code, and the deltas are:

- `targets[].status` gained `'superseded'` (spec only listed
  `'pending' | 'delivered'`) — a derived read-time status, not a
  third kind of stored ack; see "Target status vocabulary" above.
- `listDevices()` rows gained `isCreator` (spec listed only `key,
  name, isSelf, online`).
- The constructor gained `bootstrap` (test-only; not part of the
  production contract).
- Two additional events exist beyond the spec's four: `'update'`
  (the raw signal the four scoped events are derived from) and
  `'error-joining'` (surfaces a failed restart-resumed `joinGroup`).
- `core.deviceName` and `core.storageDir` are readable properties
  (the spec didn't call them out, but shells reasonably need to read
  back the values they passed to the constructor).

Folding these back into spec §3.1 itself is deferred to the
controller's final review (out of scope for this file, which documents
code as it stands).
