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
