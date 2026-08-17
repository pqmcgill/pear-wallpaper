# Pear Wallpaper — Design Spec

**Date:** 2026-08-16
**Status:** Approved design, pre-implementation
**Scope:** Personal-use P2P wallpaper sharing across the owner's devices

## 1. Summary

A peer-to-peer app built on the Pear/Holepunch stack. Any device in a
private, invite-only device group can send an image to one or more other
devices in the group, and the image becomes the target device's
desktop/home-screen wallpaper. No servers; all transport and storage is
P2P and end-to-end encrypted.

**MVP platforms:** macOS, Windows (one Pear desktop app), Android
(React Native shell embedding Bare).

**Descoped:** iOS. There is no public API to set the wallpaper on iOS;
it may return later as a *sender-only* platform, or via a Shortcuts
automation on the receiving side. Nothing in this design blocks that.

## 2. Requirements

- Targeted send: the sender picks one or more destination devices.
  Every group member has the power to set every other member's
  wallpaper. There is no per-device permission tiering (deliberate
  YAGNI for personal use).
- Authorization: only rostered devices may connect. Joining requires a
  secret invite link **and** explicit approval by the group creator.
- Delivery: queued and replicated. A send succeeds immediately; an
  offline target applies it when it next syncs. Delivery requires at
  least one member holding the data to be online at the same time as
  the target (personal-use mitigation: any always-on device acts as a
  natural relay; not required for MVP).
- Android receive model: opportunistic — apply on app open plus a
  periodic background check (~15 min, WorkManager minimum). No
  persistent foreground service.
- Receiving devices auto-apply silently; no confirmation prompt. Group
  membership *is* the consent.

## 3. Architecture

Monorepo, three packages, one shared engine:

### 3.1 `core/` — shared P2P engine

Plain JavaScript, runs on Bare identically on all platforms. The only
place P2P logic lives. Structurally a fork of Holepunch's
[autopass](https://github.com/holepunchto/autopass) example (autobase +
blind-pairing + hyperblobs + hyperswarm), with the password schema
replaced by wallpaper operations.

- **Corestore** — storage root; also holds the device's persistent
  keypair, generated on first run. The public key is the device's
  identity and its address in send targets.
- **Autobase** — the group's multi-writer operation log (§4).
- **Hyperblobs** — image bytes, referenced from log operations.
- **Hyperswarm** — connectivity and hole-punching. Connections from
  public keys not on the roster are dropped at handshake; this single
  check is the entire authorization model.
- **blind-pairing** — invite issuance/redemption and candidate
  approval.

#### Core API (locked 2026-08-17)

The complete shell-facing surface: 15 methods/getters, 4 events.
Signatures are TypeScript-flavored; implementation is plain JS.

**Lifecycle & identity**

- `new WallpaperCore({ storageDir: string, deviceName: string })` —
  single injection point for everything platform-owned, keeping the
  core environment-agnostic.
- `await core.ready(): Promise<void>` — completes storage/keypair init
  and joins the swarm; the definite point after which getters and
  events are valid.
- `await core.close(): Promise<void>` — flushes and tears down swarm/
  storage cleanly so Android's open → sync → close cycle never leaks.
- `core.deviceKey: string` (hex) — the identity shells display during
  pairing and match against the roster.
- `core.groupStatus: 'none' | 'joining' | 'member'` — routes shells to
  onboarding vs. main UI without probing internals.

**Group formation & pairing**

- `await core.createGroup(): Promise<void>` — bootstraps the autobase
  with this device as creator and sole roster entry.
- `await core.createInvite(): Promise<string>` — mints the single-use,
  expiring invite string (QR-able); the only secret a human handles.
- `await core.joinGroup(invite: string): Promise<void>` — redeems an
  invite and resolves once approved and synced; the pending promise is
  the joiner's "waiting for approval" UI state. Resumes from persisted
  state after app restart.
- `core.on('pairing-request', ({ candidateKey, name }) => …)` —
  surfaces join attempts on the creator's device.
- `await core.approve(candidateKey): Promise<void>` /
  `await core.deny(candidateKey): Promise<void>` — the human
  authorization gate; writes (or refuses) `add-device`. Creator-only;
  throws elsewhere.

**Roster**

- `await core.listDevices(): Promise<Array<{ key, name, isSelf, online }>>`
  — datasource for the send-target picker and device management.
- `await core.removeDevice(key): Promise<void>` — revocation.
- `core.on('roster-changed', () => …)` — keeps device-list UIs current
  without polling.

**Sending**

- `await core.sendWallpaper(image: string | Buffer, targets: string[]): Promise<{ id }>`
  — validates the image, stores the blob, appends `set-wallpaper`, and
  resolves immediately (queued-delivery semantics; never waits on
  targets).
- `await core.listSends({ limit = 20 }): Promise<Array<{ id, meta, sentAt, targets: [{ key, status: 'pending' | 'delivered' }] }>>`
  — backs the per-device delivered ✓ UI from `applied` acks.
- `core.on('send-updated', ({ id }) => …)` — pushes delivery-status
  flips so the UI doesn't poll.

**Receiving**

- `core.on('wallpaper', ({ id, filePath, fromKey, meta }) => …)` —
  fires only when the newest unapplied wallpaper targeting this device
  is fully fetched, validated, and written locally; the shell's
  trigger to run the OS setter, with no partial-data cases.
- `await core.pendingWallpaper(): Promise<entry | null>` — pull-based
  twin of the event so freshly-woken shells check for work without
  racing to attach listeners.
- `await core.markApplied(id): Promise<void>` — the shell's
  confirmation that the OS setter succeeded; core appends the
  `applied` ack only here, which is what makes failed applies retry
  instead of vanishing.
- `await core.listReceived({ limit = 10 }): Promise<Array<{ id, filePath, fromKey, meta, appliedAt }>>`
  — local history powering re-apply (shell re-runs its setter on an
  old `filePath`; no protocol traffic).

**Sync control**

- `await core.sync({ timeoutMs = 30000 }): Promise<void>` — bounded
  "connect, exchange with reachable peers, settle" round for Android's
  periodic task; desktops never call it (`ready()` leaves them
  continuously connected).

Deliberate cuts: no `renameDevice` (names set at approval), no
`cancelJoin` (`joinGroup` resumes after restart), no blob/GC
management (deferred with pruning), no generic `update` event.

#### Security properties (recorded from design review)

- Unauthorized peers see nothing: non-rostered keys are dropped at the
  Noise handshake before replication; independently, hypercore
  replication is capability-based (data cannot even be requested
  without the core key).
- Pending candidates see nothing until approved — blind-pairing
  discloses group keys only after approval; a denied candidate learns
  nothing.
- Roster exposure would be a privacy leak, never an authentication
  break: authenticating as a public key requires proving possession of
  the private key in the handshake, so key "spoofing" is not possible.
- Known metadata boundary: an outsider who learned the (randomly
  derived, non-guessable) swarm topic could observe IPs announcing on
  it — presence metadata only, no group data. Accepted for personal
  use.

**Contract: shells never touch hypercore-family APIs directly.** They
speak only the core API. All platforms therefore exercise identical
sync code, and the core is testable headless.

### 3.2 `desktop/` — Pear app (macOS + Windows)

HTML/JS UI running the core directly. Platform-specific code is a
~20-line wallpaper setter chosen at runtime:

- macOS: shell out to `osascript` (set on all displays/spaces;
  per-space targeting is out of scope for MVP).
- Windows: PowerShell call into `SystemParametersInfo`, with wallpaper
  fill-mode registry value set explicitly to "fill" for predictable
  results.

Distributed the Pear way (`pear run pear://…`), which provides
P2P-distributed app updates across the owner's desktops.

### 3.3 `android/` — Expo/React Native shell

- The identical `core/` bundle runs in a Bare worklet via
  `react-native-bare-kit`; a thin RPC layer bridges the worklet IPC
  channel to the UI.
- Native module calls `WallpaperManager.setBitmap()`. MVP sets the
  home screen; lock screen is a settings toggle.
- An Expo background task wakes the worklet ~every 15 minutes to
  sync-and-apply. OEM battery managers may suppress it; accepted,
  because app-open sync is the guaranteed path.
- Registers as a system share-sheet target, so sending starts from the
  gallery rather than inside the app.
- UI: device list, share/receive status, pairing screen. Minimal.

## 4. Data model

The autobase log holds small JSON operations; every device is a
writer. Four operation types:

| Op | Fields | Writer |
|----|--------|--------|
| `add-device` | `publicKey`, `name` | creator, on approving a candidate |
| `remove-device` | `publicKey` | creator |
| `set-wallpaper` | `id`, `targets: [publicKey…]`, `blobRef`, `meta` (filename, dimensions) | any member |
| `applied` | `wallpaperId` | the target, after the OS setter succeeds |

Applying the log in order yields current state: the roster, and per
device the newest unapplied `set-wallpaper` targeting it. Targets act
only on the **latest** wallpaper addressed to them (stale queued sends
are skipped). Concurrent sends to the same device resolve by autobase
log order — deterministic on every peer.

Blob hygiene: no garbage collection in MVP (deliberate cut; personal
volume grows slowly). Received images are kept locally (last 10) for
re-apply.

## 5. Flows

**Pairing.** Creator: "add device" → invite string/QR (single-use,
expiring) → new device redeems via blind-pairing → creator sees the
candidate key + proposed name → approval writes `add-device` → roster
syncs. Pairing requires the admitting side online simultaneously; UI
must show "waiting for an existing device to come online" rather than
spin.

**Send.** Sender writes the image into its hyperblobs, appends
`set-wallpaper`, done — no waiting on the target. Any online member
replicates the op and blob, so data outlives the sender's session.

**Receive/apply.** On wake (app open, desktop resume, Android periodic
task): sync → find newest unapplied wallpaper targeting this device →
fetch blob from whichever peer has it → write to local file → run the
platform setter → append `applied` **only after the setter succeeds**
(failed applies stay queued and retry next sync).

## 6. Error handling and edge cases

- **Invites:** expired/used invites fail with a clear message; remedy
  is always a fresh invite.
- **Revocation semantics:** `remove-device` stops all future access
  (connection refused at handshake) but the removed device keeps what
  it already replicated. P2P revocation cannot unsee the past.
- **Lost device storage:** the keypair is gone; the device re-pairs as
  a new device and the orphaned roster entry is removed manually.
- **Blob not yet available:** op present but no online peer has the
  blob → mark pending, retry each sync; never a hard error.
- **Image validation before apply:** known formats only
  (JPEG/PNG/WebP), size cap ~20 MB, decode check. Corrupt blobs
  degrade to a visible "failed to apply."
- **Setter failures:** surfaced as per-device status; the missing
  `applied` ack keeps the send queued for retry.
- **Sender-visible delivery status:** per-target pending / delivered ✓
  driven by `applied` acks.

## 7. Testing

- **Core (backbone, TDD):** multi-peer integration tests with
  `brittle`, in-memory corestores, and a local DHT testnet — several
  core instances in one process. Scenarios: pair/approve/roster-sync;
  targeted send reaches only its targets; offline-queue then
  apply-on-restart; removed device refused; concurrent sends resolve
  identically everywhere; ack flow drives sender status. Runs in CI in
  seconds. The deferred core API spec becomes the test skeleton.
- **Platform setters:** standalone smoke scripts run manually per OS,
  with read-back verification where the OS allows (macOS and Windows
  both expose the current wallpaper path).
- **Shells:** contract tests against a faked core (calls and events
  cross the boundary correctly). No UI automation.
- **Release gate:** manual e2e checklist on real devices — pair
  Mac + Windows + Android, send every direction, sleep/queue scenario,
  Android background apply, revoke and confirm lockout.

## 8. Open items

- Always-on relay peer: optional, zero-redesign addition later.
- Blob pruning: add if storage ever matters.
- iOS sender-only mode / Shortcuts receiver: possible future phase.
