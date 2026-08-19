# Desktop Shell Design — `desktop/` (Electron + pear-runtime, macOS-first)

**Status:** Approved design, pre-plan (runtime pivot revision).
**Scope:** Plan 2 of the pear-wallpaper project. The desktop shell that runs
the frozen `core/` engine (`core/README.md`) and turns received images into
the Mac's wallpaper. Windows is explicitly a later plan; this one ships macOS
end-to-end.

Supersedes design spec §3.2 (`docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md`).
Where this document and §3.2 differ, this document wins.

---

## 0. Runtime pivot (why this document was revised)

This spec originally targeted a **Pear app** whose GUI came from the
`pear-electron` library. That path is dead:

- **`holepunchto/pear-electron` was archived (read-only) on 2026-04-27** — no
  fixes, no future release. Even its `1.9.0-rc.0` and its own build scripts
  still invoke `pear run`, which the current **Pear CLI `3.2.0` removed**.
- `pear build` requires a pre-existing native app shell that pear-electron's
  now-defunct tooling used to produce — a confirmed dead end (spike:
  `docs/notes/spike-pear-v3.md`).
- The CLI's own removal message points to a **different** library,
  `pear-runtime`, not pear-electron.

**Resolution (this revision): a standalone Electron app that embeds the
`pear-runtime` library for OTA updates**, with the P2P core running in a Bare
worker `pear-runtime` launches. This keeps everything that made the app work —
the entire `core/`, and all the runtime-agnostic shell logic — and reclaims the
one thing Pear gave us for free (P2P auto-update) via `pear-runtime`. What the
pivot costs is the `pear run` dev-loop and Pear-native packaging, replaced by
Electron tooling.

The app's **behavior, UI, security model, and sync logic are unchanged** from
the pre-pivot design; only the runtime, IPC transport, tray/window APIs,
native-dependency story, and distribution differ.

---

## 1. Decisions locked during brainstorming

- **Runtime: a standalone Electron app** (packaged with **electron-forge**)
  that **embeds `pear-runtime`** for OTA updates. Not a Pear/`pear-electron`
  app (see §0).
- **Core runs in a Bare worker**, launched via `pear-runtime`, **not** in the
  Electron main process. Bare ships prebuilt native addons, so the core's
  native deps (`sodium-native`, `udx-native`, …) need **no `electron-rebuild`**
  — the core already runs on Bare unchanged. This also mirrors the planned
  Android shell (core in a Bare worklet + a bridge over Bare IPC).
- **Background app**, not a plain window app. Menu-bar/tray presence, survives
  window close, applies wallpapers in the background. Correct shape for a
  *receiver*.
- **macOS first.** OS-specific pieces (wallpaper setter, launch-at-login) sit
  behind a tiny interface so Windows drops in later without touching the shared
  shell.
- **UI: Preact + htm, no bundler for the UI modules** — reused verbatim; they
  render identically under Electron's renderer.
- **Send flow: drag-drop + file-picker, then target multi-select**, with image
  validation (JPEG/PNG/WebP, ≤20 MB) done by the core before send.
- **QR invites now.** Scannable QR of the invite string alongside copyable text.
- **No in-app device rename.** The frozen core has no rename op; device name is
  chosen at first boot (default hostname, persisted in a config file) and shown
  **read-only** in Settings. (Corrects the pre-pivot draft, which wrongly said
  "editable.")
- **Keychain key custody deferred** (parent design §8). MVP posture: keypair on
  disk under the app's storage dir, protected by FileVault + file perms.
- **OTA: full auto-update, apply on relaunch** (see §8).

---

## 2. Runtime & process model

**Three tiers.** This is the foundation the rest of the design rests on.

- **Electron main process** (`main.js`) — owns the `BrowserWindow`(s) and
  `Tray`, single-instance, launch-at-login management, app lifecycle, and
  embeds **`pear-runtime`** (for OTA + to launch the worker). It runs **no P2P
  logic itself**; it is a **dumb frame-relay** between the renderer and the
  worker.
- **Bare worker** (`worker/core-host.js`) — launched by `pear-runtime`
  (`pear.run('./worker/core-host.js', …)`). Runs **`WallpaperCore`**, the
  **background sync engine**, the **wallpaper setter**, and **`bridge-main`**
  (command dispatch + event forwarding) over **Bare IPC**. The holepunch native
  stack lives here on Bare's prebuilts — no Electron rebuild.
- **Renderer** (Chromium) — the Preact + htm UI + `bridge-ui`, over Electron
  `contextBridge`/`ipcRenderer`. Pure presentation; holds only the latest
  snapshot pushed from the worker (via the relay).

**Message path:** `renderer ⇄ (contextBridge/ipcRenderer) ⇄ Electron main
(relay) ⇄ (Bare IPC) ⇄ worker (bridge-main + core)`. Because the bridge is
**transport-agnostic** (`{ send, onMessage }`), `bridge-main` and `bridge-ui`
are reused unchanged; only thin transport adapters at each end are new, and the
main-process relay just forwards frames both directions.

**Native-dependency story:** solved by running the core on **Bare** (its
prebuilds), so the Electron build never bundles or rebuilds the core's native
addons. The Electron shell itself is vanilla.

**Menu-bar/tray survival:** intercept the window's `close` event → `hide()` the
window instead of quitting; `app.dock.hide()` for a menu-bar-only presence; the
worker (and thus the core) keeps running because it's `pear-runtime`-managed,
independent of window visibility.

---

## 3. Launch-at-login — spike findings (still valid; target changed)

The launch-at-login spike (against the target Mac) stands: use a **LaunchAgent
plist**, not `osascript` login items.

| Approach | Verdict |
|---|---|
| `osascript` login item (System Events) | **Rejected.** The read-only query alone hung ~2 min — triggers an interactive TCC *Automation* prompt. Unusable headless. |
| **`LaunchAgent` plist** (`~/Library/LaunchAgents/`) | **Chosen.** Verified end-to-end: write plist → `launchctl bootstrap gui/$(id -u) <plist>` → `RunAtLoad` fired → `launchctl bootout` → delete. No prompt, no sudo, no GUI, fully reversible. |
| `SMAppService` | Not pursued — requires a signed, packaged `.app`; heavier than needed for personal use. |

**Post-pivot change — the target.** The plist's `ProgramArguments` now point
directly at the **built `.app` executable**, not a `pear` binary or `pear://`
link:

```xml
<key>ProgramArguments</key>
<array>
  <string>/Applications/Pear Wallpaper.app/Contents/MacOS/Pear Wallpaper</string>
</array>
```

(exact executable name = the electron-forge `productName`). `login-item.js`'s
plist-writing logic (labels, `launchctl bootstrap`/`bootout`) is reused
verbatim; only the argument construction in the boot code changes, and it no
longer needs any Pear key/link. (Electron's `app.setLoginItemSettings` is a
possible alternative, but the LaunchAgent path is already built and tested.)

---

## 4. IPC bridge vocabulary

The bridge is the contract between the renderer and the worker. Commands are
request/reply with a correlation id; events are pushed one-way. Reused
unchanged from the pre-pivot implementation; it now rides two IPC hops (Electron
IPC + Bare IPC) via the main-process relay, transparently.

**Commands (renderer → worker):**
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
- `setLoginAtLogin(bool)`

(No `setDeviceName` — the core has no rename op; name is fixed at first boot.)

**Events (worker → renderer):**
- `state` — a fresh full snapshot, pushed on core `update`/`roster-changed`/
  `send-updated`/`wallpaper`, engine `applied`, or a candidate arriving.
- `candidate` — a pending join to approve (candidate key + proposed name).
- `error` — surfaced failures (apply failed, invite expired/used, auto-resume
  join failed), each `{ message }`.

**State model:** the renderer holds only the **last snapshot** and re-renders on
each `state` event — the UI is a pure function of that snapshot; all P2P truth
lives in the worker. Every bridge command maps to exactly one frozen core method
(`core/README.md`) except `reapply` (looks up the file in `listReceived` then
calls the platform setter) and `setLoginAtLogin` (drives the LaunchAgent); the
bridge adds no new P2P behavior.

---

## 5. Module structure

Reused modules keep their paths; the pivot rewrites the runtime glue and adds
the Electron/worker split.

```
desktop/
  package.json            # electron + electron-forge + pear-runtime deps; forge config; scripts.dev
  forge.config.js         # electron-forge packaging (macOS .app), productName
  main.js                 # ELECTRON MAIN: BrowserWindow, Tray, single-instance,
                          #   login-item wiring, pear-runtime embed, worker launch, frame relay
  preload.js              # contextBridge: expose the IPC transport to the renderer
  worker/
    core-host.js          # BARE WORKER: boots WallpaperCore + sync-engine + bridge-main over Bare IPC
  lib/                    # runtime-agnostic — REUSED UNCHANGED
    bridge-main.js        # command dispatch + event forwarding (transport-agnostic)
    sync-engine.js        # background sync/apply loop (event-push + timer + wake)
    device-name.js        # persisted first-boot device name resolver
    login-item.js         # LaunchAgent plist write/bootstrap/bootout (target set by caller)
    platform/
      index.js            # selects impl by process.platform
      darwin.js           # osascript wallpaper setter + read-back
      # win32.js          # later plan; same interface
    # single-instance.js  # retired from the boot path (Electron's app.requestSingleInstanceLock
                          #   replaces it); module + tests kept in-tree, unused
  ui/                     # RENDERER (Preact + htm) — REUSED UNCHANGED
    index.html
    app.js                # root, routes on groupStatus; ErrorBanner
    bridge-ui.js          # call(cmd,args) + on(event) (transport-agnostic)
    qr.js                 # invite QR (@paulmillr/qr)
    components/           # Onboarding, Waiting, DeviceList, Send, Received, Settings, MainView, ErrorBanner
  lib/transport/          # NEW thin adapters for the {send,onMessage} contract
    electron-ipc.js       # renderer/main side over ipcRenderer/ipcMain (+ preload)
    bare-ipc.js           # worker side over Bare IPC
```

**Platform interface (`lib/platform/index.js`)** — unchanged, deliberately tiny:
`setWallpaper(filePath): Promise<void>` and `currentWallpaper(): Promise<string>`.
`darwin.js` uses `osascript`; `win32.js` slots in later.

---

## 6. UI screens

Unchanged from the pre-pivot design (all components reused). Routed off
`groupStatus` from the latest snapshot:

- **`none`** → **Onboarding**: *Create group* (→ invite string + QR) or *Join*
  (paste invite; join waiting/rejection UX is owned locally by Onboarding,
  mapping the `joinGroup` promise rejection to friendly text).
- **`joining`** → **Waiting**: "waiting for an existing device to come online",
  or a restart-resumed-join failure message.
- **`member`** → main window, tabs:
  - **Devices** — roster with online/offline; creator-only invite (string+QR),
    candidate approve/deny cards, per-device remove. Non-creators see the roster
    read-only (the core enforces the real creator-only policy; the UI gate is
    cosmetic).
  - **Send** — drag an image or browse (`File.path` with a
    `getPathForFile` fallback); preview; check target device(s); Send.
    Per-target status (pending / delivered ✓) from `listSends()`.
  - **Received** — last-10 history with previews, current, per-item **re-apply**.
  - **Settings** — read-only device name + device key, **Launch at login**
    toggle, and **last-sync** time. Plus, post-pivot, an update affordance
    (see §8): show "update available — restart to apply" and a restart button.

A dismissible **ErrorBanner** at the app root surfaces `error` events so
failures (e.g. a denied Automation prompt) aren't silent.

**Tray menu** (Electron `Tray`, no renderer needed): group summary, last-sync
time, *Open window*, *Sync now*, *Quit*. Clicking shows the window; *Quit*
closes the worker/core and exits.

---

## 7. Background sync engine

Reused unchanged (`lib/sync-engine.js`), now running **inside the Bare worker**.
Three triggers:

1. **Event-push (real-time):** core emits `wallpaper` → run the apply pipeline
   immediately.
2. **Timer (safety net):** every **2–5 minutes** `core.sync()` then check for
   unapplied work.
3. **Wake-from-sleep:** on resume, force a `sync()`. Post-pivot this is cleanly
   wireable — Electron's **`powerMonitor`** (in the main process) is available;
   main signals the worker to `syncNow()` on `resume`. (Still non-load-bearing —
   the timer covers it within one interval.)

**Apply pipeline** (per unapplied wallpaper targeting us), reusing the frozen
core API exactly:

```
core.pendingWallpaper()  → { id, filePath, meta } | null
   ↓ (if non-null)
platform.setWallpaper(filePath)   → osascript, all displays/spaces
   ↓ (on success only)
core.markApplied(id)     → appends the `applied` ack
```

**Failure discipline** (unchanged): blob not ready → `null` → wait, never an
error; setter fails → do **not** `markApplied` (stays queued, retried), emit
`error`. All async event listeners and fire-and-forget calls route rejections
through the module's `error` channel rather than crashing the process.

**Single-instance:** post-pivot, use Electron's **`app.requestSingleInstanceLock()`**
in `main.js` — a second launch is refused and focuses the existing window (the
`second-instance` event). The pre-pivot pidfile module (`single-instance.js`)
is retired from the boot path but kept in-tree.

---

## 8. Storage, identity, distribution & OTA

- **Storage.** `main.js` derives the storage dir from Electron's
  `app.getPath('userData')` and passes it to the worker → `new
  WallpaperCore({ storageDir, deviceName })`. Keypair, corestore, autobase, and
  blobs persist there across restarts **and OTA updates** (the OTA bundle and
  the user's data are separate — see below), so no re-pairing on update.
- **Device name.** Default = machine hostname on first boot, persisted via
  `device-name.js`; read-only in Settings (no core rename op).
- **Key custody (MVP).** Keypair on disk in the storage dir, FileVault + file
  perms. Keychain-backed custody deferred (parent design §8).
- **Distribution + OTA.** The **native Electron shell** (`.app`) is built once
  per Mac/arch with **electron-forge** (`electron-forge make`/`package`) and
  installed/copied to the owner's Macs. On top of it, **`pear-runtime` provides
  OTA for the app's JS/UI/worker bundle** — *not* the native binary:
  - `pear touch` once to mint an **upgrade link**; store it in the app's
    `pear-runtime` config (e.g. `package.json` `upgrade`/`app` field).
  - After each code change: `pear stage <link> .` from the dev machine, and
    `pear seed <link>` from one always-on seeder.
  - Each running app embeds `pear-runtime`, which **checks for updates in the
    background, downloads the new bundle, and applies it on next relaunch**
    (the app surfaces "update available — restart to apply" per §6; emits
    `updating`/`updated`).
  - The native shell is re-built and re-distributed **only** for Electron- or
    native-level changes; day-to-day feature updates ride OTA.

---

## 9. Testing & QA

Same philosophy as the core: test decision logic automatically, smoke-test OS
and runtime effects by hand.

- **Automated (`brittle`) — reused, still green:** `sync-engine.js` (apply
  pipeline + failure discipline, faked core + fake setter), `bridge-main.js` /
  `bridge-ui.js` (command dispatch, event forwarding, correlation — against a
  fake transport; **the transport-agnostic design is what lets these keep
  passing across the pivot**), `login-item.js` (real reversible LaunchAgent),
  `device-name.js`, and the UI components (render-to-string off a snapshot).
  The two new transport adapters (`electron-ipc.js`, `bare-ipc.js`) are
  unit-tested via the same fake-endpoint pattern.
- **Manual (macOS) — updated `docs/notes/qa-desktop.md`:**
  - `platform/darwin.js` real `osascript` set-and-read-back.
  - Electron boot: window opens, renderer↔main↔worker round-trip
    (`getState`), the `File.path`/`getPathForFile` send path on real Electron.
  - Tray, close-hides-to-tray, single-instance focus, `Quit` teardown.
  - Launch-at-login against a built `.app`.
  - **OTA:** `pear touch`/`stage`/`seed`, confirm an app instance detects the
    update and applies it on relaunch.
  - Two Macs: pair via invite string+QR, send both directions, background apply
    while hidden, sleep/wake, revoke and confirm lockout.

**Honest limits:** the end-to-end paths (real wallpaper change, background
apply, launch-at-login, OTA relaunch) are manual by nature. The
highest-uncertainty piece is the **exact `pear-runtime` embedding + OTA
bundle/relaunch API** — pinned against the installed `pear-runtime` +
`hello-pear-electron` in the first implementation task, which reports back
before the rest proceeds if it diverges.

---

## 10. Non-goals / deferred

- **Windows** — later plan; `win32.js` behind the existing platform interface.
- **Android** — Plan 3 (shares the Bare-worker + bridge topology).
- **Keychain key custody** — parent design §8.
- **Blob pruning / GC** — parent design §8.
- **Per-space / per-display wallpaper targeting** — MVP sets all displays/spaces.
- **Lock-screen wallpaper** — out of scope on desktop.
- **Code-signing / notarization of the `.app`** — out of scope for personal use;
  revisit if distributing beyond the owner's own machines.
