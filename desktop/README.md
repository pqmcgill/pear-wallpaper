# pear-wallpaper-desktop

The macOS desktop shell for pear-wallpaper. A standalone **Electron** app
(packaged with `electron-forge`) that embeds the **`pear-runtime`** library
for P2P over-the-air updates, and launches `pear-wallpaper-core` (the P2P
engine, in `../core`) inside a **Bare worker** it spawns.

This supersedes an earlier `pear run`/`pear-electron`-based design that
never shipped — `pear-electron` was archived upstream and Pear CLI 3.x
removed `pear run` out from under it (see `docs/notes/spike-pear-v3.md` and
`docs/superpowers/specs/2026-08-19-desktop-shell-design.md` for the full
pivot rationale).

## Architecture: three tiers

```
renderer (Chromium, Preact + htm UI)
  ⇄ contextBridge/ipcRenderer   (preload.js)
  ⇄ Electron main               (main.js)
  ⇄ Bare IPC                    (newline-JSON frames, lib/transport/*)
  ⇄ Bare worker                 (worker/core-host.js)
```

- **Electron main** (`main.js`) — owns the `BrowserWindow` and `Tray`,
  single-instance locking (`app.requestSingleInstanceLock()`),
  launch-at-login management, app lifecycle (close-to-tray, graceful
  shutdown), and embeds `pear-runtime` (to launch the worker and to watch
  for OTA updates). It runs **no P2P logic** itself — it's a dumb frame
  relay between the renderer and the worker.
- **Bare worker** (`worker/core-host.js`) — launched via
  `PearRuntime.run()` (which, from a plain-Node Electron host, spawns a
  real `bare-sidecar` OS subprocess). Runs `WallpaperCore`, the background
  sync engine, the macOS wallpaper setter, and `bridge-main` (command
  dispatch + event forwarding) over `Bare.IPC`. The holepunch native stack
  (`sodium-native`, `udx-native`, …) runs here on Bare's own prebuilds, so
  packaging this app **never needs an `electron-rebuild` step**.
- **Renderer** — the Preact + htm UI, reused verbatim from the pre-pivot
  design, talking to `bridge-ui` over a thin `contextBridge`/`ipcRenderer`
  transport. It holds only the latest snapshot pushed from the worker and
  re-renders as a pure function of it.

The bridge (`lib/bridge-main.js` / `ui/bridge-ui.js`) is transport-agnostic
(`{ send, onMessage }`), so neither it nor any UI component changed across
the pivot — only thin adapters at each hop are new
(`lib/transport/bare-ipc.js`, `ui/electron-ipc.js` — the latter lives in
`ui/` as browser ESM because the file:// renderer has no bundler and cannot
import CJS from `lib/`), plus
`main.js`'s relay, which just forwards frames both directions without
parsing them.

## Layout

- `main.js` — Electron main entry: window/tray/single-instance/login-item,
  embeds `pear-runtime`, launches the worker, relays IPC frames, handles
  graceful shutdown and OTA.
- `preload.js` — `contextBridge`: exposes `window.bridgeTransport`
  (`send`/`onMessage`) to the renderer.
- `worker/core-host.js` — Bare worker entry: boots `WallpaperCore` +
  sync-engine + `bridge-main` over `Bare.IPC`; handles the `{t:'shutdown'}`
  control frame.
- `lib/` — runtime-agnostic logic, reused unchanged from the pre-pivot
  shell: `bridge-main.js`, `sync-engine.js`, `device-name.js`,
  `login-item.js` (LaunchAgent plist write/bootstrap/bootout),
  `platform/` (`darwin.js`'s `osascript` wallpaper setter, selected via
  `platform/index.js`), plus `compat/` (Bare shims for `process` and
  `child_process`, needed because Bare has no Node builtins) and
  `transport/` (the worker-side `bare-ipc.js` adapter; the renderer-side
  adapter is `ui/electron-ipc.js`, see above). `single-instance.js` is kept
  in-tree but retired from the boot path (Electron's own lock replaces it).
- `ui/` — the Preact renderer (Onboarding/Waiting/MainView with
  Devices/Send/Received/Settings tabs), reused unchanged. `ui/index.html`
  loads `ui/app.js`, and carries an inline import map (CSP-hashed — see the
  comment in the file and `test/renderer-modules.test.js`) that resolves the
  renderer's bare specifiers, since the page is plain file:// with no
  bundler.
- `forge.config.js` — electron-forge packaging config (macOS `.app` via
  `@electron-forge/maker-zip`, `productName: 'Pear Wallpaper'`).

## Dev / package / make / test

```bash
cd desktop
npm install          # sync package-lock.json against package.json
npm test             # brittle test/*.test.js — the automated suite
npm run dev           # == electron-forge start — local dev, one instance,
                      #   window opens rendering Onboarding
npm run package       # electron-forge package — unpacked app for the
                      #   current platform, no installer
npm run make          # electron-forge make — produces a distributable
                      #   .app (zip maker), under out/
```

Two instances (for pairing/send QA) each need their own Electron
`userData` dir — pass the Chromium `--user-data-dir` switch (Electron
apps honor it automatically before `app.whenReady()`; no code change
needed, and this app's single-instance lock is scoped per `userData` dir):

```bash
npm run dev -- -- --user-data-dir=/tmp/pw-a    # "device A"
npm run dev -- -- --user-data-dir=/tmp/pw-b    # "device B", separate terminal
```

(Double `--` required: npm consumes the first, and `electron-forge start`
needs its own `--` before args it forwards to the Electron process — with
one `--` forge dies on `unknown option`. Details in `docs/notes/qa-desktop.md`.)

Launch-at-login and OTA only exercise meaningfully against a **built**
`.app` (see `npm run make` above) — the LaunchAgent points at
`app.getPath('exe')` and the updater only calls `applyUpdate()` when
`app.isPackaged`. Full manual checklist, including how to run two built
copies side by side: **`docs/notes/qa-desktop.md`**.

## OTA workflow

The native Electron shell (the `.app`) is built once per Mac/arch with
`electron-forge` and installed on the owner's Macs directly — it is
**not** what OTA updates. On top of it, the embedded `pear-runtime`
library provides P2P OTA for the app's JS/UI/worker bundle:

1. **Mint an upgrade link once** (already done for this app — see
   `package.json`'s `upgrade` field):
   ```bash
   pear touch
   ```
2. **After each code change**, stage the new bundle onto that link:
   ```bash
   pear stage <link> .
   ```
3. **Seed it** from one always-on machine so running instances can fetch
   it:
   ```bash
   pear seed <link>
   ```
4. Every running app has already constructed `new PearRuntime({ upgrade,
   ... })` in `main.js` — it watches the link in the background, downloads
   the new bundle, and once ready fires `pear.updater`'s `'updated'` event,
   which `main.js` forwards to the renderer as an `update-ready` bridge
   event. Settings then shows **"Update available — restart to apply"**;
   clicking Restart calls `pear.updater.applyUpdate()` then relaunches.

The native shell only needs re-building/re-distributing for Electron- or
native-level changes; day-to-day feature updates ride OTA. `pear-runtime`
and `pear-runtime-updater` are explicitly experimental upstream — treat the
OTA path as the least battle-tested part of this app (flagged further in
`docs/notes/qa-desktop.md`'s Act 11).

## Testing split

- **Automated (`npm test`)** — every module under `lib/` and `ui/` has
  brittle unit/component tests with injectable dependencies (fake `fs`,
  fake `exec`, fake `bridge`/`core`/transport endpoints): single-instance
  locking, the wallpaper setter's argv-safety, the LaunchAgent plist
  writer, the device-name resolver, the sync engine's apply/coalesce/
  error-surfacing logic, both new transport adapters
  (`lib/transport/bare-ipc.js`/`ui/electron-ipc.js`), the bridge's
  command/event wire protocol on both ends, the renderer module graph's
  import-map/CSP-hash/ESM invariants (`test/renderer-modules.test.js`), and
  every Preact component's rendering + bridge-call wiring. Current:
  **53/53 tests, 120/120 asserts, pristine** — no stray warnings, no skips.
- **Manual (GUI/OS effects `npm test` cannot reach)** — real window
  rendering, the renderer↔main↔worker IPC round-trip actually crossing
  process boundaries, macOS's one-time Automation permission prompt for
  the `osascript` wallpaper setter (now invoked from inside the Bare
  worker), tray behavior, close-to-tray backgrounding, sleep/wake,
  single-instance focus, the LaunchAgent's real `launchctl` activation
  against a built `.app`, and the full OTA cycle (`pear touch`/`stage`/
  `seed` → detect → apply on relaunch). Full checklist:
  **[`docs/notes/qa-desktop.md`](../docs/notes/qa-desktop.md)**.

## Known limitations

- `ui/components/Send.js`'s file-path resolution for the Send tab's
  browse/drag-drop now uses `webUtils.getPathForFile`, exposed to the
  renderer as `window.pathForFile` by `preload.js` (final-review fix
  wave; replaces the earlier `pear-electron` dynamic import, which never
  resolved once that dependency was removed in the pivot). This has not
  been smoke-tested against a real Electron `File` object end-to-end —
  see `docs/notes/qa-desktop.md`'s Act 3 for the manual smoke pass this
  still needs.
