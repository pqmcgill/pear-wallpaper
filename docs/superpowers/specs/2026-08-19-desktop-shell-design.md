# Desktop Shell Design — `desktop/` (Pear app, macOS-first)

**Status:** Approved design, pre-plan.
**Scope:** Plan 2 of the pear-wallpaper project. The desktop shell that runs
the frozen `core/` engine (`core/README.md`) and turns received images into
the Mac's wallpaper. Windows is explicitly a later plan; this one ships macOS
end-to-end.

Supersedes design spec §3.2 (`docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md`),
which sketched the desktop shell before the `pear-electron` UI model and the
tray/background requirement were settled. Where this document and §3.2 differ,
this document wins.

---

## 1. Decisions locked during brainstorming

- **Runtime: a Pear app**, not standalone Electron. Modern Pear (v3+) renders
  its desktop UI through the `pear-electron` library — Electron *is* the UI
  layer under the hood — so a Pear app gives us both Pear's P2P distribution +
  auto-update to the owner's own devices **and** Electron's mature
  tray/window/IPC APIs. The Pear-vs-Electron choice was a false dichotomy.
- **Background app**, not a plain window app. It lives in the menu-bar/tray,
  keeps running when the window is closed, and applies wallpapers in the
  background. This is the correct shape for a *receiver*.
- **macOS first.** OS-specific pieces (wallpaper setter, launch-at-login) sit
  behind a tiny interface so Windows drops in later without touching the
  shared shell.
- **UI: Preact + htm, no build step.** Component model and reactivity, still
  plain ESM imports — no bundler, keeping `pear run` and packaging simple.
- **Send flow: drag-drop + file-picker, then target multi-select**, with
  image validation (JPEG/PNG/WebP, ≤20 MB) before send.
- **QR invites now.** Show a scannable QR of the invite string alongside the
  copyable text, so the future Android shell can pair immediately.
- **Keychain key custody deferred** (design spec §8 open item). MVP posture:
  keypair on disk under Pear app storage, protected by FileVault + file perms.

---

## 2. Runtime & process model

Because `pear-electron` is Electron, the app is **two processes**. This is the
foundation the rest of the design rests on.

- **Main process (Bare/Node)** — owns `WallpaperCore`, the background sync
  loop, the system tray, the macOS wallpaper setter, launch-at-login
  management, and app lifecycle. The holepunch native stack
  (hyperswarm/udx/sodium) lives here. **This process survives the window being
  hidden**, which is what makes background receiving work.
- **Renderer (Chromium)** — the Preact + htm UI. Pure presentation; holds no
  P2P state of its own, only the latest snapshot pushed from main.
- **IPC bridge** — a thin, *curated* command/event layer over `pear-electron`'s
  `win.send()` / `win.on('message')`. Not a blind mirror of all 15 core
  methods — only what the UI needs (see §4).

This is structurally the same shape as the planned Android shell (core in a
background context, thin UI over an RPC/event bridge). The bridge vocabulary is
shared thinking across both shells.

**Tray survival mechanism (verified against Pear docs):** set
`pear.gui.closeHide: true` in `package.json`; closing the window hides it while
main keeps running. Tray built via `ui.app.tray({ icon, menu }, listener)`
(from `pear-electron`; the old `Pear.tray`/`Pear.Window` APIs were removed in
Pear v2.6.5+ and moved to `pear-electron`'s `ui.*`).

---

## 3. Launch-at-login — spike findings (resolved)

Launch-at-login is **not** exposed by `pear-electron`. A spike on the target
Mac resolved the approach:

| Approach | Verdict |
|---|---|
| `osascript` login item (System Events) | **Rejected.** The read-only query alone hung ~2 min — it triggers an interactive TCC *Automation* permission prompt. Unusable headless. |
| **`LaunchAgent` plist** (`~/Library/LaunchAgents/`) | **Chosen.** Verified end-to-end: write plist → `launchctl bootstrap gui/$(id -u) <plist>` → `RunAtLoad` fired → `launchctl bootout` → delete. No prompt, no sudo, no GUI, fully reversible. |
| `SMAppService` | Not pursued — requires a signed, packaged `.app`; heavier than needed for personal use. |

**Design consequence:** `lib/login-item.js` in the main process manages
`~/Library/LaunchAgents/com.pear-wallpaper.plist`. The settings toggle "Launch
at login" maps to *write plist + `launchctl bootstrap`* (enable) and
*`launchctl bootout` + delete* (disable). The plist's `ProgramArguments` invoke
the `pear` binary with the app URL (`pear run pear://<key>`).

**Open implementation details** (do not block the plan; resolve during Task
work):
- Resolving the exact `pear` binary path at enable-time (`pear` was not
  installed on the spike machine).
- Launch-at-login is validated against a **staged/released** build (it needs a
  stable `pear://<key>`), not against `pear run --dev .`.

---

## 4. IPC bridge vocabulary

The bridge is the contract between the two processes. Commands are
request/reply with a correlation id; events are pushed one-way.

**Commands (renderer → main):**
- `getState()` → `{ deviceKey, deviceName, groupStatus, roster, sends,
  received, loginAtLogin, lastSync }` — one snapshot the UI renders from.
- `createGroup()`
- `createInvite()` → invite string
- `joinGroup(invite)`
- `approve(candidateKey)`, `deny(candidateKey)`
- `removeDevice(key)`
- `sendWallpaper({ filePath, targets })`
- `reapply(wallpaperId)`
- `syncNow()`
- `setDeviceName(name)`
- `setLoginAtLogin(bool)`

**Events (main → renderer):**
- `state` — a fresh full snapshot, pushed whenever the core's `update` /
  `wallpaper` fires, a candidate arrives/decides, or sync status changes.
- `candidate` — a pending join to approve (candidate key + proposed name).
- `error` — surfaced failures (invite expired/used, apply failed, image
  rejected), each with a human-readable message.

**State model:** the renderer holds only the **last snapshot** and re-renders on
each `state` event. The UI is a pure function of that snapshot — there is no
client-side store to keep in sync with the core. This is the simplest correct
model and it keeps all P2P truth in one process.

Every bridge command maps to exactly one frozen core method (`core/README.md`);
the bridge adds no new P2P behavior, only marshalling and snapshotting.

---

## 5. Module structure

The OS-specific surface is isolated behind one small interface so the shared
shell never branches on platform.

```
desktop/
  package.json          # pear config: gui.closeHide, app key, pear-electron dep
  index.js              # MAIN: boots WallpaperCore, tray, sync loop, IPC host
  lib/
    bridge-main.js      # IPC host: command dispatch + event forwarding (main side)
    sync-engine.js      # background sync/apply loop (timer + push + wake)
    tray.js             # ui.app.tray menu build + click routing
    login-item.js       # LaunchAgent plist write/bootstrap/bootout
    platform/
      index.js          # selects impl by process.platform
      darwin.js         # osascript wallpaper setter + read-back
      # win32.js        # later plan; same interface
  ui/                   # RENDERER (Preact + htm, no build)
    index.html
    app.js              # root component, routes on groupStatus
    bridge-ui.js        # IPC client: call(cmd, args) + on(event)
    qr.js               # no-build ESM QR generator for invite strings
    components/
      Onboarding.js     # create-or-join
      Waiting.js        # joining / "waiting for a device to come online"
      DeviceList.js     # roster, candidate approval, invite (creator), remove
      Send.js           # drag-drop + picker + target-select + per-target status
      Received.js       # last-10 history, current, re-apply
```

**Platform interface (`lib/platform/index.js`)** — deliberately tiny:
- `setWallpaper(filePath): Promise<void>` — set on all displays/spaces.
- `currentWallpaper(): Promise<string>` — for read-back verification in the
  smoke test.

`darwin.js` implements both with `osascript`. `win32.js` slots in later behind
the same interface with zero changes to `sync-engine.js` or the UI. Same
discipline as `core/lib/`.

---

## 6. UI screens

Routed off `groupStatus` from the latest snapshot:

- **`none`** → **Onboarding**: *Create group* (→ shows invite string + QR) or
  *Join* (paste invite string).
- **`joining`** → **Waiting**: "waiting for an existing device to come online"
  (pairing needs the admitting side online simultaneously — design spec §5).
- **`member`** → main window, three tabs:
  - **Devices** — roster with online/offline indicators; creator-only invite
    button (string + QR); creator-only pending **candidate** approval cards
    (approve/deny); per-device remove (creator-only). Non-creator devices see
    the roster read-only, matching the core's creator-only policy.
  - **Send** — drag an image onto the window or click to pick; preview +
    validation (JPEG/PNG/WebP, ≤20 MB); check target device(s); Send.
    Per-target status (pending / delivered ✓) driven by `applied` acks via
    `core.listSends()`.
  - **Received** — last-10 history with previews, which is current, per-item
    **re-apply** button (`core.listReceived()` + `reapply`).

  A **Settings** panel (reachable from the window chrome, not a fourth primary
  tab) holds the low-frequency controls: edit device name (`setDeviceName`),
  the **Launch at login** toggle (`setLoginAtLogin`, reflecting `loginAtLogin`
  from the snapshot), and this device's key for reference.

**Tray menu** (main process, no renderer required): group summary (device
count), last-sync time, *Open window*, *Sync now*, *Quit*. Clicking the icon
shows the window; *Quit* closes the core and exits.

---

## 7. Background sync engine

Lives in the main process (`lib/sync-engine.js`). Three triggers so nothing is
missed:

1. **Event-push (real-time, while running):** the core emits `wallpaper` when a
   new send targeting this device fully arrives over a live connection → run
   the apply pipeline immediately. Fast path when the app is up and peers are
   connected.
2. **Timer (safety net):** every **2–5 minutes** call `core.sync()` then check
   for unapplied work. Catches anything the push missed (bad-timing
   connect/disconnect, window hidden, sender came online while idle). Desktops
   are usually plugged in, so this cadence is cheap.
3. **Wake-from-sleep:** on resume, force a `sync()` (connections were torn down
   during sleep). If `pear-electron` exposes Electron's `powerMonitor`, wire
   it; if not, the timer covers wake within one interval — so this trigger is a
   nice-to-have, not load-bearing.

**Apply pipeline** (per unapplied wallpaper targeting us), reusing the frozen
core API exactly:

```
core.pendingWallpaper()  → { id, filePath, meta } | null   (blob fetched, validated, written)
   ↓ (if non-null)
platform.setWallpaper(filePath)   → osascript, all displays/spaces
   ↓ (on success only)
core.markApplied(id)     → appends the `applied` ack (drives sender's ✓)
```

**Failure discipline** (matches the core contract):
- Blob not available yet → `pendingWallpaper()` returns `null` → wait for the
  next trigger. Never an error.
- Setter fails → do **not** `markApplied`; the send stays queued and retries
  next cycle; emit an `error` event. `markApplied` firing only after setter
  success is what keeps apply safe to retry.

**Single-instance lock:** the LaunchAgent-started process and a manually-opened
one must not both run the core against the same storage. Main takes an OS-level
single-instance lock on startup; a second launch signals the first to show its
window, then exits.

---

## 8. Storage, identity, distribution

- **Storage.** Pass Pear's per-app storage path (`Pear.config.storage`, stable
  across auto-updates) into `new WallpaperCore({ storageDir, deviceName })`.
  Device keypair, corestore, autobase, and blobs persist there across restarts
  and updates — no re-pairing on update.
- **Device name.** Defaults to the machine hostname on first run; editable in
  settings (`setDeviceName`). It is what other devices display in roster and
  target-picker.
- **Key custody (MVP).** Keypair on disk in the storage dir, protected by macOS
  FileVault + file perms. Keychain-backed `primaryKey` custody stays deferred
  (design spec §8).
- **Distribution.** `pear run --dev .` for development; `pear stage <channel>`
  + `pear release` for release. The app is addressable at `pear://<key>`; other
  Macs run it once and receive **P2P auto-updates** thereafter. Main listens
  for `pear-electron` update events and can restart to apply — no installer, no
  code-signing pipeline, no electron-updater.

---

## 9. Testing & QA

Matches the core's philosophy (design spec §7): test the decision logic
automatically, smoke-test the OS effects by hand.

- **Automated (`brittle`):**
  - `sync-engine.js` against a **faked core** (stub `sync` /
    `pendingWallpaper` / `markApplied` / events) + a **fake platform setter**:
    each trigger fires a sync; non-null `pendingWallpaper` runs the setter then
    `markApplied`; **setter failure skips `markApplied` and retries**; null
    pending is a no-op. Highest-value coverage — correctness lives here.
  - `bridge-main.js` command dispatch / event forwarding against a faked core.
  - `login-item.js` plist write → `bootstrap` → marker → `bootout`, reversible,
    unique labels (the spike promoted to a real test).
- **Manual (macOS only):**
  - `platform/darwin.js` — real `osascript` set-and-read-back smoke script.
  - E2E QA script (like `docs/notes/qa-pairing.md`): two Macs or two storage
    dirs — create group, pair via invite string + QR, send both directions,
    hide-to-tray and confirm background apply, sleep/wake, launch-at-login
    against a staged build, revoke and confirm lockout.
- **UI:** contract-level only — components render correctly off a snapshot and
  emit the right commands. No browser automation (design spec §7).

**Honest limit:** the truly end-to-end paths — real wallpaper changing on
screen, background apply while hidden, launch-at-login, auto-update — are manual
by nature. The automated suite covers the decision logic; OS effects are
verified by hand. Same split the core used.

---

## 10. Non-goals / deferred

- **Windows** — later plan; `win32.js` behind the existing platform interface.
- **Android** — Plan 3.
- **Keychain key custody** — design spec §8 open item.
- **Blob pruning / GC** — design spec §8; personal volume grows slowly.
- **Per-space / per-display wallpaper targeting** — MVP sets all displays/spaces.
- **Lock-screen wallpaper** — out of scope on desktop.
