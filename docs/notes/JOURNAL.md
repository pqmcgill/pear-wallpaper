# Journal
- 2026-08-17 Task 1: scaffold + smoke test green (corestore/hyperswarm/testnet working)
- 2026-08-17 Task 2: WallpaperCore lifecycle + identity + local meta (identity = autobase local-writer key)
- 2026-08-17 Task 3: createGroup + autobase log + roster view (creator-only roster policy enforced in apply)
- 2026-08-17 Task 4: invites + candidate pairing (creator-only invite ops; explicit approval gate — no auto-admit)
- 2026-08-17 Task 4 review addendum: 2 fix rounds — userData validation (crash fix), creator-gated _onCandidate, supersede semantics with settled promises, 24h invite expiry, candidate-side 'rejected' event wired (blind-pairing DOES surface dead invites, one level below its swallowing poll loop)
- 2026-08-17 Task 5: approve/deny complete pairing; rosters converge end-to-end
- 2026-08-17 Task 6: roster-gated connections + revocation (gate = who's on the wire; apply = what ops count)
- 2026-08-17 Task 7: per-device hyperblobs store; cross-peer fetch by capability over gated connections
- 2026-08-18 Task 8: sendWallpaper (validate → blob → op → resolve immediately); listSends pending status
- 2026-08-18 Task 9: receive pipeline (newest-unapplied detection, bounded blob fetch, atomic file materialization, wallpaper event + pendingWallpaper)
- 2026-08-18 Task 10: applied acks close the loop (delivered/superseded status, send-updated events, received history)
- 2026-08-18 Task 11: bounded sync + blob relaying; offline delivery via relay proven (sender-offline scenario)
- 2026-08-18 Task 12: scenario matrix green (multi-target, full-restart, revocation-blocks-send); API README written; core-v0.1.0
- 2026-08-18 FINAL whole-branch review (opus): 4 Critical (3 proven security holes) + 8 Important. Fixed C1–C4 + I1–I3 on-branch in one wave (0b512ee), re-reviewed clean, 45/45 tests. Tag core-v0.1.0 re-pointed to 0b512ee. Spec §3.1 as-built deltas folded in. I4–I8 ruled to Plan 2.

## Plan 2 (desktop shell)

- 2026-08-19 Tasks 1–11: macOS Pear desktop shell shipped end-to-end on top
  of `pear-wallpaper-core`. What shipped: single Pear app (`desktop/`) that
  boots `WallpaperCore` in the Bare-hosted main process; a Preact renderer
  (Onboarding/Waiting/MainView with Devices/Send/Received/Settings tabs)
  served via `pear-bridge`; a `pear-pipe`-backed IPC bridge
  (`lib/bridge-main.js` + `ui/bridge-ui.js`, `{req,res,evt}` wire protocol
  over the `runtime.start()` duplex) exposing
  `getState/createGroup/createInvite/joinGroup/approve/deny/removeDevice/
  sendWallpaper/reapply/syncNow/setLoginAtLogin/quit`; a macOS wallpaper
  setter over `osascript`/System Events (`lib/platform/darwin.js`, argv-safe
  against injection); a LaunchAgent-based launch-at-login manager
  (`lib/login-item.js`, XML-escaped plist, `launchctl bootstrap`/`bootout`);
  a background sync engine (`lib/sync-engine.js` — timer + `core`'s
  `'wallpaper'` event + `syncNow`, coalesced concurrent-apply, never throws
  out of an async trigger); and a pidfile-based single-instance lock
  (`lib/single-instance.js`, TOCTOU-guarded reclaim of stale locks). Tray
  (Open/Sync now/Quit) lives in `ui/tray.js`. 11 implementation tasks, each
  TDD'd and reviewed; every round's findings fixed on-branch (see
  `.superpowers/sdd/2026-08-19-desktop-shell/progress.md` for the
  per-task ledger) — the recurring pattern across Tasks 3–7,10 was
  unhandled async rejections / overly-broad `catch{}` in the plan's own
  convenience code, fixed each time and eventually pre-empted proactively
  in Task 11.
- 2026-08-19 Process-model correction (Task 9): the plan's Section 1
  assumed `ui.app`/tray/`win.send` were reachable from the Bare-hosted main
  process (`index.js`). Reading the installed `pear-electron@1.7.28`
  (npm package + upstream source not shipped in it — `boot.js`,
  `electron-main.js`, `gui/ipc.js`) showed **pear-electron IS Electron
  under the hood**, and `Pear.constructor.UI`/`ui.app` only get constructed
  *inside the Electron process it spawns* — never in Bare-main. So tray
  creation and the transport's "main" side had to move: tray lives in
  `ui/tray.js` (renderer-side, calls the real `ui.app.tray`), and the IPC
  transport rides the `pear-pipe`-backed duplex `runtime.start({bridge})`
  hands back on both ends (`lib/pear-transport.js` in Bare-main,
  `ui/pear-transport.js` in the renderer) rather than `win.send`. Full
  citation trail in `task-9-report.md`. This is the one load-bearing
  assumption Task 12's manual QA (`docs/notes/qa-desktop.md`, Act 1) exists
  to confirm — it was built from source-reading, never from a live run.
- 2026-08-19 Launch-at-login spike → LaunchAgent (Task 3): went with a
  `~/Library/LaunchAgents/com.pear-wallpaper.plist` managed via
  `launchctl bootstrap`/`bootout` (fully reversible, no admin needed,
  standard macOS per-user login item) rather than a login-items API. The
  plist's `ProgramArguments` invoke `pear run pear://<key>`, so it only
  resolves against a **staged** build (`pear stage`/`pear release`) — a
  `pear run --dev .` session's binary path is a best-effort guess
  (`Bare.argv[0]` falling back to `process.execPath`), never verified
  end-to-end; flagged in both `task-9-report.md` and the Task 12 QA script.
- 2026-08-19 Device-rename deviation: spec originally called for an
  in-app-editable device name. The frozen `core` (Plan 1, tagged
  `core-v0.1.0`) has no rename operation — device identity/name is set at
  construction and only ever read back via `listDevices()`. Rather than
  add a rename op to a frozen, reviewed core, the name is resolved once at
  first boot (`lib/device-name.js`: persisted `device-name.txt`, defaults
  to `os.hostname()`) and Settings renders it **read-only**, with an inline
  hint to edit the file before joining a group to change it.
- 2026-08-19 Deferred (surfaced during implementation, not blocking):
  `ui/bridge-ui.js` has no `off`/unsubscribe (only matters if `MainView`
  remounts on a leave/rejoin flow, which doesn't exist yet); `Onboarding`'s
  `create()` handler has no try/catch around
  `createGroup().then(() => createInvite())` (narrow failure path, logs
  only, doesn't crash main); wake-from-sleep has no dedicated
  `powerMonitor` hook — the existing timer + `'wallpaper'`-event triggers
  cover it per spec §7's "nice to have" framing, and `pear-electron` isn't
  confirmed to expose `powerMonitor` at all; Windows platform
  setter/tray/login-item are out of scope, `lib/platform/` already
  isolates the OS-specific pieces behind `selectPlatform()` for that later
  work; tray icon (`ui/trayTemplate.png`) is a generated placeholder shape,
  not a designed asset.
- 2026-08-19 Task 12: lockfile sync (`pear-pipe` was in `package.json` but
  missing from `package-lock.json`'s root deps entry since Task 9 added it
  without a re-`npm install`; `npm ci` now succeeds). Full automated suite:
  **37/37 tests, 73/73 asserts, pristine** (`cd desktop && npm test`).
  Manual QA script written (`docs/notes/qa-desktop.md`) covering the GUI/OS
  smoke that can't be automated headlessly: two-instance pairing over
  `pear run --dev . --store <path>`, the pear-pipe transport check, send/
  receive with the macOS Automation prompt, background/tray delivery while
  the window is hidden, sleep/wake, launch-at-login against a staged
  build, revocation, and offline re-apply.

## Plan 2 pivot: Pear→Electron+pear-runtime

- 2026-08-19 Pivot rationale (spike: `docs/notes/spike-pear-v3.md`): the
  Task 12 shell above never actually ran. `holepunchto/pear-electron` was
  archived (read-only) 2026-04-27 — no further releases — and Pear CLI
  `3.2.0` **removed `pear run`** entirely (`pear run .` now errors
  "Use the pear-runtime module instead"), which pear-electron's own
  dev-loop and even its own build/release scripts depend on. `pear build`
  is also a dead end: it injects a staged project into a pre-existing
  native app shell that pear-electron's now-defunct `bootstrap`/`decal`
  tooling used to produce, and there's no working path to that shell
  today. The CLI's own removal message, and the `hello-pear-electron`
  template it points to, name the actual v3-supported shape: a plain
  Electron app (packaged with `electron-forge`) that embeds the
  **`pear-runtime`** library directly for P2P OTA + Bare workers. Spec
  revised accordingly: `docs/superpowers/specs/2026-08-19-desktop-shell-design.md`
  (supersedes the Task 12-era §3.2 spec where they differ).
- 2026-08-19 New three-tier architecture (design spec §2, built Tasks 1–7 on
  branch `desktop-shell-electron-conversion`): **Electron main process**
  (`main.js`) owns the `BrowserWindow`/`Tray`/single-instance/login-item and
  embeds `pear-runtime`, but runs **no P2P logic** — it's a dumb frame
  relay. **Bare worker** (`worker/core-host.js`), launched via
  `PearRuntime.run()`, runs `WallpaperCore`, the sync engine, the wallpaper
  setter, and `bridge-main` over `Bare.IPC` — the holepunch native stack
  lives here, on Bare's own prebuilds. **Preact renderer** (unchanged UI)
  talks to the worker over `contextBridge`/`ipcRenderer` via `preload.js`,
  through the main-process relay. Message path: `renderer ⇄ (contextBridge/
  ipcRenderer) ⇄ Electron main (relay) ⇄ (Bare IPC, newline-JSON frames) ⇄
  worker (bridge-main + core)`.
- 2026-08-19 Key discoveries (full citation trails in
  `.superpowers/sdd/2026-08-19-desktop-shell-electron-conversion/task-{2,3,6}-report.md`):
  - `PearRuntime.run()` from a plain-Node Electron main resolves to
    `bare-sidecar`'s `Sidecar` — a **real OS subprocess** running the
    bundled `bare` binary, wired to an fd-3 IPC pipe; the worker's global
    `Bare.IPC` is the other end. This meant the core (and its native deps —
    `sodium-native`, `udx-native`, …) run unmodified on **Bare's own
    prebuilds**, so the pivot needs **no `electron-rebuild`** step at all.
  - Bare has **no Node builtins** (`fs`/`path`/`os`/`child_process`/`util`
    all fail to resolve, and there's no global `process`). Fixed without
    touching any reused module: `package.json`'s `"imports"` field remaps
    those specifiers to `bare-*` equivalents (mirroring the trick
    `core/package.json` already used for `fs`/`path`), plus two new
    `lib/compat/{process,child_process}.js` shims — the `child_process` one
    wraps `bare-subprocess`'s `spawn` to fake `execFile`'s callback shape
    for `login-item.js` and `darwin.js`.
  - Config (storageDir/exePath) travels via **argv**, not `opts` —
    `bare-sidecar`'s `Sidecar` constructor doesn't read `opts` at all,
    confirmed against the installed package.
  - Graceful shutdown needed a **message-level** control frame
    (`{ t: 'shutdown' }`), because `workerPipe.destroy()` SIGTERMs the bare
    process with no JS-visible worker-side event, and `.end()` only
    half-closes and never reaches process exit — both confirmed empirically
    with a throwaway harness. `main.js` sends the frame on `before-quit`,
    waits (2s fallback) for the worker's `exit`, then force-destroys.
  - OTA rides a **separate** `pear-runtime` capability from the static
    `.run()` used for the worker: `new PearRuntime(opts).updater` (a
    `pear-runtime-updater` instance) — its constructor eagerly opens a
    Corestore and **joins a Hyperswarm DHT swarm** even under plain
    `npm run dev`, watching the `upgrade` link for updates; `applyUpdate()`
    only actually swaps the bundle when `opts.bundled`/`app.isPackaged`.
  - The transport-agnostic bridge design (`bridge-main`/`bridge-ui`'s
    `{send, onMessage}` contract) paid off exactly as intended across the
    pivot: neither module, nor any UI component, nor their tests, needed
    editing — only two new thin adapters (`lib/transport/bare-ipc.js`,
    `lib/transport/electron-ipc.js`) and the main-process relay were new.
- 2026-08-19 Reused unchanged: `lib/bridge-main.js`, `lib/sync-engine.js`,
  `lib/device-name.js`, `lib/login-item.js`, `lib/platform/*`, and the
  entire `ui/` tree (Preact components + their tests) — all of Plan 2's
  Task 1–11 logic and tests survived the pivot untouched. Rewritten/new:
  boot (`main.js` replaces the old Bare-main `index.js`; `worker/
  core-host.js` is new), transport (`lib/transport/bare-ipc.js`,
  `lib/transport/electron-ipc.js`, `preload.js`), tray (moved into
  `main.js` — Electron's `Tray` API, not the old renderer-side
  `ui/tray.js`), single-instance (Electron's
  `app.requestSingleInstanceLock()` replaces the pidfile-based
  `lib/single-instance.js`, which is kept in-tree but retired from the
  boot path), login-item target (built `.app` executable path instead of
  a `pear://<key>` link), and OTA (new — `pear-runtime`/`pear-runtime-updater`
  wiring in `main.js`, `updateReady` plumbed into `ui/app.js` and
  `ui/components/Settings.js`). Dead files from the old topology
  (`index.js`, `lib/pear-transport.js`, `ui/pear-transport.js`) deleted;
  nothing imports them.
- 2026-08-19 Deferred/carried to the final fix wave (not fixed in this
  docs-only task — see
  `.superpowers/sdd/2026-08-19-desktop-shell-electron-conversion/progress.md`):
  (a) `ui/components/Send.js`'s `resolveFilePath` still does a live
  `await import('pear-electron')` as its `File.path` fallback, but
  `pear-electron` was removed as a dependency in Task 1 — on any Electron
  build where `File#path` is undefined (Electron ≥32; this app pins
  `electron@^33`), both browse and drag-drop in the Send tab are broken
  (caught, surfaced as an error banner, doesn't crash); the real fix is
  `webUtils.getPathForFile` via a preload→main IPC round-trip. (b)
  `pear.updater` has no `'error'` listener wired with real handling beyond
  a `console.error` — matches the upstream example but a zero-listener
  EventEmitter emitting `'error'` has bitten this project before; a
  one-liner for the fix wave. (c) OTA is exercised against
  `pear-runtime-updater`, which self-describes as "VERY EXPERIMENTAL, MOST
  DEFINITELY WILL CHANGE," and its `applyUpdate()` deployment-folder layout
  (`/by-arch/<platform-arch>/app/<name>`) is unverified against a real
  `pear stage` of this app's own `npm run make` output. (d) the
  `osascript`/`launchctl` success paths, now running through the
  `bare-subprocess`-backed `child_process` compat shim inside the Bare
  worker, have only had their **failure** branch (a `launchctl print` miss)
  exercised end-to-end — the success paths are must-smoke items in
  `docs/notes/qa-desktop.md`.
- 2026-08-19 Task 8 (final): full automated suite **48/48 tests, 87/87
  asserts, pristine** (`cd desktop && npm test`) — the reused 37/37 suite
  plus Task 7's new adapter tests. `docs/notes/qa-desktop.md` rewritten
  end-to-end for this architecture (Electron boot, IPC round-trip via
  DevTools, two-instance setup via `--user-data-dir`, pairing, send both
  directions with the known Send.js caveat, the osascript/launchctl
  must-smoke, close-to-tray background delivery, sleep/wake, tray menu,
  single-instance, launch-at-login against a built `.app`, OTA must-smoke,
  revoke, offline re-apply); `desktop/README.md` rewritten for Electron
  dev/package/make and the new testing split.
- 2026-08-21 Blank-white-window fix: root cause was the Pear→Electron
  conversion leaving the renderer's module graph unresolvable — main.js
  `loadFile`s ui/index.html as plain file:// with no bundler, so the bare
  specifiers (`preact`, `preact/hooks`, `htm`, `@paulmillr/qr`) threw
  "Failed to resolve module specifier" (Pear's bundler used to resolve
  them), and app.js's one surviving CJS import
  (`lib/transport/electron-ipc.js`) would have thrown "module is not
  defined" right after. Fix: inline `<script type="importmap">` in
  ui/index.html mapping the four bare specifiers to their browser-ESM files
  in node_modules (covers preact/hooks' internal `import "preact"` too),
  plus an explicit CSP `script-src 'self' 'sha256-…'` allowlisting the
  map's exact text (external import maps aren't supported in Electron 33's
  Chromium; inline scripts need the hash); transport adapter moved to
  `ui/electron-ipc.js` as ESM (ui/ is the `"type": "module"` scope) and the
  lib/ CJS copy deleted. New guard `test/renderer-modules.test.js` (TDD:
  written first, failed 4/5 against the old tree) asserts import-map
  coverage of every bare specifier, that map targets and relative imports
  resolve on disk, that the CSP hash tracks the current map text, and that
  the transport module stays ESM. Suite: 53/53 tests, 120/120 asserts
  (was 48/87).
- 2026-08-23 Android-shell Task 1: lifted bridge-main/sync-engine/
  transport into a new sibling package `bridge/` (`pear-wallpaper-bridge`)
  so Android can share the protocol layer instead of forking it; transport
  renamed `duplex-json.js`/`createDuplexJsonTransport` and rewritten on
  b4a instead of `Buffer` (Buffer isn't a global in RN); `bridge-ui` is the
  package's one `.mjs` export (genuine browser ESM for the no-bundler
  renderer) while its three siblings stay CJS for Node/Bare `require` and,
  later, Metro; `pendingWallpaper`/`markApplied` added as unconditional
  bridge commands (Android's RN apply path polls/acks over the bridge
  directly, spec §3.2) and `reapply`/`setLoginAtLogin`/`syncNow` made
  conditional on `platform`/`loginItem`/`engine` being passed in. Caught
  empirically via the real Electron boot check (not by the unit suites):
  `bridge/package.json` needed its own `"imports"` remap of `'events'` to
  `bare-events` under Bare — the old desktop/lib/sync-engine.js's bare
  `require('events')` only ever worked because an unrelated devDependency
  (webpack, via electron-forge) happened to leave an `events` polyfill
  sitting in desktop's node_modules; `bridge/`'s own node_modules has no
  such fluke, and Bare has no built-in 'events'. Desktop: 35/35 tests,
  85/85 asserts (down from 53/53 — the four moved suites now run in
  `bridge/`: 20/20 tests, 47/47 asserts there).
- 2026-08-23 Android-shell Task 2: scaffolded `android/` from holepunchto/
  bare-expo (Expo SDK 55, RN 0.83.6, react-native-bare-kit 0.15.0 pinned
  exact); the template's own `app/index.tsx` was already the one-screen
  worklet echo this plan needs, converted to `.js`. Two real Gradle/AGP
  bugs blocked the Step 4 emulator boot, both root-caused and fixed
  persistently rather than worked around locally: (1)
  `foojay-resolver-convention@0.5.0`, pinned inside
  `@react-native/gradle-plugin`'s included build, throws `NoSuchFieldError`
  against Gradle 9.0.0 — fixed via a `patch-package` patch bumping it to
  1.0.0; (2) AGP 9.5.0-alpha02's prefab/CMake step misclassifies JDK 25's
  JEP 472 "restricted native access" warning banner as a fatal build
  error (root-caused via `javap` on the AGP jar) — no JVM-flag workaround
  exists (every flag-injection mechanism prints its own banner that trips
  the same bug) and no second JDK exists on this machine, so fixed via
  Gradle 9's Daemon JVM criteria feature (auto-provisioned JDK 21), wired
  to survive CNG regeneration through a new local Expo config plugin
  (`android/plugins/withGradleJvmFix.js`). Full findings in
  `docs/notes/api-divergences.md`. Verified end-to-end from a from-scratch
  `expo prebuild` + `expo run:android`: `BUILD SUCCESSFUL`, echo screen
  shows "Hello from Bare!" on the emulator, worklet-side `console.log`
  visible in logcat (under the app's own package tag, not literally `bare`
  — also a recorded divergence). `metro.config.js` watches `../bridge` and
  `../core` for Tasks 3-4. Jest: `jest-expo` + `@testing-library/react-native`
  14.0.1 (whose `render()` is async, unlike the brief's sync sketch — test
  awaits it); `test/smoke.test.js` mocks `react-native-bare-kit` and
  renders the echo screen without the native module. `npm run test:ui`:
  1/1 tests, pristine.
- 2026-08-23 Android-shell Task 3: `android/worklet/host.js` factors the
  runtime-agnostic worklet host out of the 6-line BareKit entry
  (`android/worklet/core-host.js`) so brittle can drive it in Node against
  the REAL `pear-wallpaper-core` stack with an in-memory duplex standing
  in for `BareKit.IPC`. Protocol: first inbound frame must be
  `{ t: 'init', storageDir, deviceName, intervalMs? }` (config crosses the
  IPC as a message, not argv — there's no sidecar spawn on Android, RN
  owns storageDir/deviceName); host replies `{ t: 'evt', event: 'ready' }`
  (or `'error'` with `{ message }`) before speaking any bridge frames;
  `{ t: 'shutdown' }` stops the engine, closes the core, and calls
  `exit()`. `platform: null` into `createSyncEngine` is how the
  apply-inversion reaches the engine — Android applies wallpapers RN-side,
  not from a shell-owned platform module. `npm run test:worklet`
  (`brittle test-worklet/*.test.js`): 1/1 tests, 4/4 asserts, pristine.
  Two unbudgeted findings (both in `docs/notes/api-divergences.md`): jest
  was also matching `test-worklet/*.test.js` via its default `testMatch`
  and failing on it (fixed with `testPathIgnorePatterns` in
  `jest.config.js` — `npm run test:ui` stayed green, 1/1); `bare-pack` had
  no established pin anywhere in the repo, so pinned to `2.2.1` (current
  npm latest). `npm run bundle:worklet` (`bare-pack --linked --host
  android-arm64 --host android-x64 --out app/gen/worklet.bundle.mjs
  worklet/core-host.js`) resolved `pear-wallpaper-core`/`-bridge` straight
  through their `file:../core`/`file:../bridge` symlinks with no extra
  flags needed, and rewrote both `sodium-native` and `udx-native` (plus 9
  more transitive native addons) to `linked:lib<name>.<version>.so`
  specifiers in the bundle's JSON header — confirmed by grep, not embedded
  binaries. `android/app/gen/` stayed gitignored (`git status` shows no
  bundle).
- 2026-08-23 Android-shell Task 4: RN shell wired to the real core —
  `lib/store.js` (`reduce`/`initialSnapshot`, ported verbatim from the
  brief, same joining/joinError fold as desktop `ui/app.js`);
  `lib/worklet-client.js`'s `getBridge()` module-level singleton (single-
  writer rule, enforcement point 1) sends the init frame the instant the
  Worklet starts and disambiguates the terminal-error contract from
  `worklet/host.js`: an `'error'` evt arriving before `'ready'` ever fired
  means the init failed and the Bare process exited, so the singleton is
  nulled for a fresh `getBridge()` next time; an `'error'` evt *after*
  `'ready'` is an ordinary operational failure (engine/auto-resume-join)
  forwarded by `bridge-main` and must NOT tear down a live worklet — this
  distinction isn't in the brief's own worklet-client sketch and was
  worth a dedicated jest case. `app/_layout.js` owns the `SnapshotContext`
  provider, the `useReducer(reduce, initialSnapshot)`, and the two RN-only
  lifecycle duties the desktop renderer never had: calling `getBridge()`
  once on mount, and an `AppState` listener translating `active`/
  `background` into `getWorklet()?.resume()` + `syncNow()` /
  `getWorklet()?.suspend(30000)` (confirmed `suspend(linger)`/`resume()`
  instance methods match `react-native-bare-kit@0.15.0`'s `.d.ts` exactly,
  no divergence there). `app/index.js` replaces the Task 2 echo screen
  with `groupStatus`-based routing (Onboarding/Waiting/MainView) plus an
  `ErrorBanner` overlay, ported from `desktop/ui/app.js`/`components/*`
  logic onto RN primitives. Two real divergences hit and recorded in
  `docs/notes/api-divergences.md`: (1) `bare-pack`'s `.bundle.mjs` output
  is a plain `export default "<bundle string>"`, consumed the same way
  the Task 2 template consumed its inline source string — no metro change
  needed (`.mjs` is already in Metro's default `sourceExts`), but
  jest-expo's preset transform regex (`\.[jt]sx?$`) doesn't cover `.mjs`,
  so both this bundle import and `pear-wallpaper-bridge/ui` (real ESM)
  failed under jest until `jest.config.js` added
  `transform: { '\\.mjs$': 'babel-jest' }` alongside the preset. (2)
  `expo-file-system`'s `Paths.document` isn't a renamed string constant —
  it's a `Directory` whose `.uri` is a `file://` URI (confirmed from the
  Android native module source); `worklet-client.js` strips the scheme
  for a plain fs path since the worklet's corestore wants one, same as
  desktop's `app.getPath('userData')`. On-device milestone exceeded scope:
  not only did Onboarding render clean on `emulator-5554` (fresh install,
  clean `adb logcat`, no `[worklet] init failed`), but pressing "Create a
  group" live drove the full pipeline through a real `createGroup()` on
  the actual Autobase/Corestore stack and routed to `MainView` showing
  "Devices in group: 1"; `adb shell run-as ... ls files/pear-wallpaper/corestore`
  confirmed a real `CORESTORE`/rocksdb `db/` on disk at the expected path.
  App data cleared afterward (`pm clear`) for a fresh Task 5 start.
  `npm run test:ui`: 11/11 pristine; `npm run test:worklet`: 2/2 tests,
  8/8 asserts, unchanged and still green. Full script + evidence in
  `docs/notes/qa-android.md` Act 1.
- 2026-08-23 Android-shell Task 5: pairing — QR scan + join flow.
  `components/ScanInvite.js` (`expo-camera`'s `CameraView` +
  `useCameraPermissions`, latched `onBarcodeScanned` — TDD'd first against
  a mocked `expo-camera`); "Scan invite" button on `Onboarding` sharing
  the paste path's join handler; `Waiting` joinError + retry copy.
  `expo-camera@55.0.22` installed via `npx expo install`, pinned exact;
  `app.json` plugin entry adds the Android CAMERA permission
  (`recordAudioAndroid: false` — no mic needed). First real cross-shell
  pairing milestone: since no desktop GUI was drivable in this session, a
  scripted Node peer (throwaway, run from `desktop/`, real
  `WallpaperCore` — same API/events the desktop worker uses, not a mock)
  stood in for it. Live invite → emulator paste-and-join → scripted
  peer's `pairing-request` → `approve()` → emulator `Waiting`→`MainView`
  ("Devices in group: N"), peer's `listDevices()` showing the Android
  device online — round-tripped twice (before and after the fix below).
  On-device QA surfaced two real, pre-existing bugs, both fixed in
  Android's files this task (desktop has the same latent gaps, left
  unfixed there — out of scope): (1) a LIVE interactive join, not just a
  restart-resumed one, routes the UI to `Waiting` before `joinGroup()`
  settles — core's `_onConnection` fires `roster-changed` the instant the
  joiner's own candidate socket opens — so a live deny was landing
  `Onboarding`'s local `joinError` on an already-unmounted screen;
  `dispatch` is now threaded from `app/index.js` into `Onboarding` so the
  rejection also reaches shared `snapshot.joinError`. (2)
  `blind-pairing-core`'s coded errors format `Error#message` as
  `${code}: ${msg}`, not the bare code, so both shells' friendly-message
  lookup tables (exact-match by code) never actually matched anything;
  switched to a prefix match. Verified live: a real deny now renders "The
  creator denied this device." on `Waiting`, not the generic fallback.
  Also verified: a garbage/undecodable invite never opens a connection,
  so `Onboarding` stays mounted and shows its own local error correctly.
  Camera-path QR scan documented for a human with a display (Android
  Studio's Extended Controls camera-image injection isn't drivable
  headlessly); the scan step itself is unit-tested in isolation and hands
  off into the identical, already-verified `attemptJoin`/error path.
  `npm run test:ui`: 14/14 pristine (11 carried + 3 new); `npm run
  test:worklet`: unchanged, 2/2 tests, 8/8 asserts. Full script, invite
  strings, and screenshots described in `docs/notes/qa-android.md` Act 2.
- 2026-08-23 Android-shell Task 6: WallpaperManager Expo module + apply
  controller — first cross-platform wallpaper apply. `lib/apply-controller.js`
  (`createApplyController`) mirrors `sync-engine.applyPending`'s coalesced-pass
  semantics exactly, just over two bridge commands instead of direct core
  calls: `pendingWallpaper()` → `setWallpaper(filePath, target)` (native) →
  `markApplied(id)`, a setter/ack failure leaving the item unacked for the
  next trigger. Native side: `android/modules/wallpaper-setter/`, a local
  Expo Module (`create-expo-module --local`, autolinked from `modules/`
  with no npm package) wrapping `WallpaperManager.setStream` in one
  `AsyncFunction`. Wired in `_layout.js`: the controller runs after every
  bridge `state` push and once after the initial `getState`; `getTarget`
  hardcoded to `'home'` until Task 7's settings module. On-device QA (fresh
  pair via the Task 5 scripted-peer pattern, extended to `sendWallpaper()` a
  distinctive magenta test PNG) found and fixed one real bug before the
  milestone worked: `app.json`'s `android.permissions` never reached the
  built APK, because `expo run:android` only runs `prebuild` when
  `android/android/` (gitignored, CNG output) is absent — since it already
  existed from prior tasks, the new `SET_WALLPAPER` permission was silently
  dropped until an explicit `npx expo prebuild --platform android --clean`.
  Also found and flagged (not fixed, pre-existing, outside this task's
  scope): a resumed group's very first `getState` request can race ahead of
  `core.ready()`'s swarm-bootstrap and be silently dropped by the
  transport's queueless `onMessage`, stranding the UI on `Onboarding`
  despite the core genuinely being a member. Milestone confirmed: the
  desktop peer's `listSends()` showed the target status flip to
  `'delivered'` (ack round-tripped), and the emulator's home-screen
  screencap changed from the stock wallpaper to the solid magenta test
  image. `npm run test:ui`: 26/26 (23 carried + 3 new
  `apply-controller.test.js` cases). `npm run test:worklet`: unchanged, 2/2
  tests, 8/8 asserts. Full narrative, bug writeups, and before/after
  screenshots in `docs/notes/qa-android.md` Act 3 and
  `docs/notes/api-divergences.md`.
- 2026-08-23 Android-shell Task 7: main UI — device list, invites, received
  history, settings. `MainView.js` grows real Devices/Received/Settings tabs
  (Send tab omitted — YAGNI, no local-file-picker flow on this milestone),
  each component's logic ported verbatim from its desktop counterpart with
  RN primitives swapped in for preact/htm. `lib/qr.js` calls the same
  `@paulmillr/qr` `encodeQR(text, 'svg')` as desktop, then merges every
  per-module `<rect>` into a single `<path>` — an Android-only fix for a
  real on-device perf bug (react-native-svg's `SvgXml` makes one native
  view per SVG element; a real invite QR's 1052 `<rect>`s became 1052
  native `RectView`s, pegging the UI thread for up to ~24s per frame,
  confirmed via `adb logcat`'s `EGL_emulation` stats and a `uiautomator
  dump` view-count). `lib/settings.js` persists `{ lockScreen }` to
  `settings.json` under the documents dir (same `expo-file-system` family
  as Task 4) and exports `getTarget()` (`lockScreen ? 'both' : 'home'`),
  wired into Task 6's `createApplyController` in `_layout.js` — replacing
  the `() => 'home'` placeholder — and consumed directly by `Received`'s
  manual reapply, which calls the native setter itself rather than any
  bridge command (Android has no `reapply` bridge command by design:
  `bridge-main.js` only registers one when a worklet-side `platform` is
  passed, and Android's worklet never has one). Also found and fixed a
  second real on-device bug: `MainView`'s nav row rendered underneath the
  translucent status bar with no safe-area inset (every earlier screen
  centers its content well below it), which wasn't just cosmetic — taps
  landing in the overlap silently never reached the tab `Pressable`s at
  all. Fixed with `useSafeAreaInsets()` (`expo-router`'s `ExpoRoot` already
  supplies a `SafeAreaProvider`). On-device QA: Android-creates-invite +
  scripted-peer-redeems eventually succeeded once (proving the
  candidate/approve UI path) but was slow and a second clean attempt never
  completed within budget — flagged as a likely emulator-NAT asymmetry
  (Task 5's proven-fast direction has the emulator as the outbound-dialing
  candidate, not the inbound-waiting creator), not a code bug, recommended
  for physical-device follow-up in Task 10. Reapply and the lock-toggle
  were fully verified via the reverse, proven-fast topology instead: a
  scripted peer creates the group and sends a wallpaper, Android
  auto-applies it, Received shows it with a working Re-apply, and flipping
  the lock-screen toggle then reapplying flipped `adb shell dumpsys
  wallpaper`'s lock record from an unset placeholder to a real
  `mWhich=3` (`FLAG_SYSTEM|FLAG_LOCK`) bind matching the applied image's
  crop — confirmed visually too, via a screencap of an actual (initially
  disabled, then `locksettings set-disabled false`-enabled) lock screen
  showing the same test image. `npm run test:ui`: 41/41 (38 carried + 3 new
  `qr.test.js` cases). `npm run test:worklet`: unchanged, 2/2 tests, 8/8
  asserts. Full narrative, bug writeups, and screenshots in
  `docs/notes/qa-android.md` Act 4 and `docs/notes/api-divergences.md`.
- 2026-08-23 Android-shell Task 8: share-sheet send — first Android→desktop
  milestone. Step 1 health check verdict: HEALTHY —
  `expo-share-intent@6.1.1` is the last release in the SDK-55-supported
  line (its own README's version table), actively maintained (603 stars,
  pushed within the month), read its installed source directly to confirm
  `requireOptionalNativeModule` (not the throws-under-jest
  `requireNativeModule`) needs no lazy-resolution workaround, and confirmed
  Android's path doesn't depend on deep-link parsing so no
  `+native-intent.ts` is needed on this platform. `app.json`'s `scheme`
  renamed `to.holepunch.bare.expo` → `pearwallpaper` (Task 7's folded
  deferred finding — confirmed load-bearing, the library reads it to key
  its native-module cache) plus `androidIntentFilters: ["image/*"]` (default
  is text-only). New: `lib/share-target.js`'s `stageSharedImage(uri)`
  (copies a shared `content://`/`file://` URI into
  `<documents>/pear-wallpaper-staging/<timestamp>.<ext>` via
  expo-file-system — the worklet's Bare fs can't open a content:// URI at
  all); `app/send.js` (image preview + per-device `Switch` targets, ported
  from desktop's `Send.js` selection logic); a `useShareIntent()` hook in
  `_layout.js` that stages the file and `router.replace('/send', ...)`.
  TDD'd first against a mocked `expo-file-system`/fake bridge
  (`test/send-screen.test.js`). `npm run test:ui`: 47/47 (41 carried + 6
  new). `npm run test:worklet`: unchanged, 2/2 tests, 8/8 asserts.
  On-device QA (Android as *sender* this time, a scripted desktop peer as
  receiver): the real system share sheet listed "Pear Wallpaper" for an
  `image/png` SEND intent fired via adb (implicit, no `-n`, so it
  genuinely round-tripped through `ResolverActivity`); warm start (app
  backgrounded) and cold start (`am force-stop` first, confirmed no task
  existed, then the intent relaunched the process straight onto the Send
  screen) both landed byte-exact transfers at the peer (`md5` of the
  peer's materialized file matched the source PNG in both cases) with no
  errors in logcat. Cold start needed no extra plumbing beyond
  `getBridge()`'s existing queue-until-ready gate (Task 6) plus
  `expo-share-intent`'s own unconditional on-mount native-module query.
  Full narrative, screenshots, and byte-hash evidence in
  `docs/notes/qa-android.md` Act 5 and `docs/notes/api-divergences.md`.
- 2026-08-23 Android-shell Task 9: background sync — spike first, then
  build. **Spike verdict: PASS** (`docs/notes/headless-worklet-spike.md`):
  a throwaway headless `expo-background-task` body started a Bare Worklet
  with an inline echo source and round-tripped one IPC frame while the app
  was backgrounded. Found and fixed a real bug along the way — an inline
  (non-bundled) `Worklet#start` source needs a non-`.bundle` filename
  (`.bundle` triggers bare-bundle parsing and crashes the native thread);
  also no global `Buffer` on either side, use `b4a`. Also discovered
  `triggerTaskWorkerForTestingAsync` and `adb ... jobscheduler run -f` are
  the same call underneath (`BackgroundTaskScheduler.runTasks()`) and both
  no-op while the app is foregrounded, by design. Built the real
  `lib/background-sync.js`'s `runBoundedSyncRound()` per the brief's sketch
  (single divergence: returns `'nudged-resident'`, not the prose's
  `'skipped-active'`, matching the sketch code over the prose). Extracted
  `lib/worklet-identity.js` (`getStorageDir`/`getDeviceName`) so
  `worklet-client.js` and `background-sync.js` construct the corestore
  path identically — divergent values would silently fork one phone into
  two device identities. Added `worklet-client.js`'s `isActive()` — the
  single-writer guard's enforcement point 2. TDD'd against a mocked
  `react-native-bare-kit`/`worklet-client` (`test/background-sync.test.js`):
  full round trip (init→ready→syncNow→drain→shutdown→terminate) and the
  guard (`isActive()` true ⇒ nudge the resident bridge, zero `Worklet`
  instances constructed). On-device QA (scripted desktop peer, three
  distinct test images): backgrounded + forced job → `'nudged-resident'`,
  wallpaper changed, byte-exact, reproduced twice; killed via `am kill`
  (not force-stop) → process respawned but froze before RN JS finished
  booting, task never ran (spec-accepted opportunism) — the pending
  wallpaper still applied correctly once the app was reopened, via the
  guaranteed sync-on-open path; force-stop → job scheduler drops the job
  immediately, confirmed rather than assumed. Foregrounded guard check
  surfaced a divergence from the brief's literal expectation: no
  `background-sync` log appears at all while foregrounded (platform-level
  no-op, not our guard). Full narrative, logcat excerpts, dumpsys
  wallpaper before/after, and md5 evidence in `docs/notes/qa-android.md`
  Act 6.
  **Review fix round** (3 Important findings, all fixed): (1) `isActive()`
  was gated on `'ready'`, not existence — a real single-writer race during
  a resident worklet's own bootstrap window would have constructed a
  second `Worklet` on the same `storageDir`; changed to `instance !==
  null` (existence is the correct guard — the wrapped bridge already
  queues calls until ready, so nudging a not-yet-ready resident is safe).
  (2) the fresh-Worklet branch was unbounded on failure: no timeout on
  `await ready` (a hung worklet never terminated) and a pre-ready error
  rejected before the `try/finally` (skipped shutdown/terminate entirely);
  fixed with a 30s ready-timeout raced via `Promise.race` and a
  restructure guaranteeing `terminate()` on every exit path — extended
  `test/background-sync.test.js` with a terminate-assertion on the
  pre-ready-error path and a new ready-timeout test. (3) **honesty
  correction**: every on-device QA scenario that actually completed a
  round took the `nudged-resident` branch — the fresh-Worklet (`'synced'`)
  branch, the actual new production machinery this task adds, has **zero
  on-device evidence** (the one scenario built to exercise it, the killed-
  app case, froze before `runBoundedSyncRound()` was ever invoked); it
  remains unit-tested and spike-adjacent only. Amended into the report's
  Concerns, `qa-android.md` Act 6, and this line — not overstated as
  device-proven. `npm run test:ui`: 59/59 pristine. `npm run test:worklet`:
  unchanged, 2/2 tests, 8/8 asserts. JS-only fix, no rebuild.
- 2026-08-23 Android-shell Task 10: QA hardening, docs, release-build pass
  (emulator, no physical device this session — controller ruling). Act 7
  (lifecycle): a send landing mid-suspend (~18s into a background window)
  was drained and applied purely by the `AppState` `'active'` →
  `resume()` + `syncNow()` path; a second pass backgrounded past the 30s
  linger (35s) produced no crash, no uncaught `Worklet has been
  terminated`, and a fresh send afterward still round-tripped normally —
  **no evidence the 30s linger needs tuning**. Act 8 (revoke): confirmed
  `core.groupStatus` never depends on roster membership, so a revoked
  device's `groupStatus` stays `'member'` forever; live-tested
  `removeDevice` against a paired emulator — **finding, reported not
  fixed**: the revoked device's UI shows no distinct "you were removed"
  state at all, just an ordinary-looking stale/offline roster (same
  underlying gap already implicit in desktop's Act 12) — doesn't spin,
  but doesn't state anything either. Act 9 (release build, emulator per
  ruling): `npx expo run:android --variant release` — `BUILD SUCCESSFUL`,
  booted with no dev-build toast (confirmed genuinely release JS), paired
  with a scripted peer, sent+applied a wallpaper, zero app-related
  crashes in logcat. Noted honestly: `enableMinifyInReleaseBuilds` is off
  by default in this checkout, so R8 shrinking isn't exercised, though the
  embedded-bundle/Hermes-AOT path (the more likely real risk surface) is.
  Restored the emulator to a working debug install (`adb install` alone
  isn't enough — needs `npm run android` for Metro) for future sessions.
  Wrote `android/README.md` (architecture, dev-loop bundle trap, logcat
  recipe, test-split rationale, scripts table, pinned-versions policy) and
  a pending-human checklist appended to `qa-android.md` (APK sideload,
  Android-as-admitting-member, killed-app `'synced'`-branch, LTE/real-NAT,
  spec §7 three-device e2e) — explicitly marked PENDING, not claimed.
  `cd bridge && npm test`: 20/20. `cd desktop && npm test`: 35/35.
  `cd android && npm run test:worklet`: 2/2 (8/8 asserts). `npm run
  test:ui`: 59/59. All four suites pristine, no code changes this task
  (QA + docs only).
- 2026-08-23 Plan 3 final review (whole-branch, post-Task-10): Ready to
  merge. Fix wave: guarded share-staging failure into the error banner
  (android crash-path) and ported the prefix-match join-error fix to
  desktop Onboarding/Waiting (bug discovered in Task 5, desktop had it
  too). Final suites: bridge 20/47, desktop 39/97, android ui 61 (14
  suites), worklet 2/8 — all green. Physical-device checklist pending
  (qa-android.md).
- 2026-09-25 Plan 4 a5-invite-presentation: Onboarding no longer mints a dead inline invite; Devices makes the creator's first invite on arrival, wrapped with a one-line instruction and QR. Join stays disabled until there is text. Live: page width 480 (was 884).
- 2026-09-25 Plan 4 a9-login-toggle: login-item now only writes or removes the plist; no bootstrap/bootout, so unticking no longer SIGTERMs a login-launched app and toggles are idempotent. Proven with a throwaway-label launchd harness.
- 2026-09-25 Plan 4 a1-online-status: Presence dot plus online/offline text in Devices and Send; core listDevices reports self online; a pending send to an offline device reads 'Waiting for <name> to come online'. First stylesheet (styles.css). One flaky hypercore session-state crash seen once in core tests; watching.
- 2026-09-25 Plan 4 a7-state-pushes: Engine emits 'synced' (timer, tray, wake, live wallpaper arrival) and bridge pushes on it; failed sync no longer stamps. pushState coalesces a 50 ms window with one snapshot in flight (241 -> 60 pushes over 60 sends); login probe cached until toggled.
