# Desktop Shell — Electron + pear-runtime Conversion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the desktop shell from a (now-dead) Pear/`pear-electron` app into a standalone **Electron** app (electron-forge) that embeds **`pear-runtime`** for OTA, running the P2P core in a **Bare worker** — reusing every runtime-agnostic module unchanged.

**Architecture:** Three tiers. **Electron main** (`main.js`) owns the window + tray + single-instance + login-item wiring + `pear-runtime` (OTA & worker launch) and is a **dumb frame-relay**. A **Bare worker** (`worker/core-host.js`) runs `WallpaperCore` + `sync-engine` + `bridge-main` over Bare IPC (native deps via Bare prebuilts — no electron-rebuild). The **renderer** runs the existing Preact UI + `bridge-ui` over a `contextBridge` preload. The bridge is transport-agnostic, so `bridge-main`/`bridge-ui` and all UI/logic modules are reused; only the transport adapters + boot glue are new.

**Tech Stack:** Electron + electron-forge; `pear-runtime` (OTA + Bare worker host); `pear-wallpaper-core` (`file:../core`); Preact + htm; `@paulmillr/qr`; `brittle` + `preact-render-to-string`.

**Spec:** `docs/superpowers/specs/2026-08-19-desktop-shell-design.md` (Electron + pear-runtime revision; see its §0 for why the pivot). Spike evidence: `docs/notes/spike-pear-v3.md`.

## Global Constraints

- **Reuse, don't rewrite, the runtime-agnostic modules.** These are already implemented and tested (45 tests green) and MUST NOT be modified except where a task explicitly says so: `lib/bridge-main.js`, `lib/bridge-ui.js`(`ui/bridge-ui.js`), `lib/sync-engine.js`, `lib/device-name.js`, `lib/login-item.js`, `lib/platform/*`, `lib/single-instance.js`, and all of `ui/components/*`, `ui/qr.js`, `ui/app.js` (app.js needs a one-line transport-source swap only). Their tests must stay green throughout.
- **Frozen core API only** (`core/README.md`): `new WallpaperCore({ storageDir, deviceName })`, `ready()/close()`, `deviceKey`, `groupStatus`, `createGroup/createInvite/joinGroup/approve/deny/removeDevice/listDevices/sendWallpaper/listSends/pendingWallpaper/markApplied/listReceived/sync`, events `wallpaper/pairing-request/roster-changed/send-updated/update/error-joining`. No hypercore-family APIs in the shell.
- **Bridge contract (unchanged):** transport is `{ send(msg): void, onMessage(cb): void }`, `msg` plain JSON-serializable. Wire protocol: `{t:'req',id,cmd,args}` → `{t:'res',id,ok,value|error}`; events `{t:'evt',event,payload}`. `createBridgeMain({ core, platform, loginItem, engine, transport }).start()`; `createBridgeUi(transport)` → `{ call(cmd,...args), on(event,cb) }`.
- **Core runs in the Bare worker, never in Electron main.** Electron main runs no P2P logic — it relays frames and manages the window/tray/OTA. This keeps the core's native deps on Bare's prebuilts (no `electron-rebuild`).
- **Module systems:** `main.js`, `preload.js`, `worker/core-host.js`, `lib/**` and their tests are **CommonJS** (root `package.json` `"type":"commonjs"`). `ui/**` is **ESM** (`ui/package.json` `{"type":"module"}`). UI/renderer-adapter tests are CJS `brittle` files using `await import(...)`.
- **Injectable side effects, unit-testable transport:** the two new transport adapters take their endpoint as an injectable dependency so they're unit-tested against a fake endpoint (no Electron/Bare needed), exactly like the existing bridge tests.
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where possible; the preload exposes ONLY the transport (`send` + `onMessage`), nothing else. No secrets/keys logged.
- **Manual-smoke honesty:** Electron boot, window/tray, the worker handshake, powerMonitor, and OTA are GUI/runtime effects that can't run headless — each such task creates files + adapts to the real installed API + reports an exact user smoke checklist; it must NOT claim GUI verification it didn't do.
- **High-uncertainty APIs pinned early:** the exact `pear-runtime` embedding + Bare-worker-launch + OTA API is version-specific; Task 2 pins it against the installed `pear-runtime` and the `hello-pear-electron` template and REPORTS the real API before later tasks build on it.
- **Commits:** conventional-commit style, one (or a few logical) per task.

---

## File Structure

```
desktop/
  package.json            # REWRITE: electron + electron-forge + pear-runtime; drop pear-electron/pear-bridge/pear-pipe + pear config
  forge.config.js         # NEW: electron-forge config (macOS .app, productName "Pear Wallpaper")
  main.js                 # NEW (replaces index.js): Electron main — window, tray, single-instance, login-item wiring, pear-runtime, worker launch, frame relay, OTA
  preload.js              # NEW: contextBridge exposes the IPC transport to the renderer
  worker/
    core-host.js          # NEW: Bare worker — boots core + sync-engine + bridge-main over Bare IPC
  lib/
    transport/
      electron-ipc.js     # NEW: renderer-side transport over the preload-exposed API ({send,onMessage})
      bare-ipc.js         # NEW: worker-side transport over the Bare IPC endpoint ({send,onMessage})
    bridge-main.js        # REUSE unchanged
    sync-engine.js        # REUSE unchanged
    device-name.js        # REUSE unchanged
    login-item.js         # REUSE unchanged (caller sets .app target)
    platform/{index,darwin}.js  # REUSE unchanged
    single-instance.js    # RETIRED from boot (kept in-tree, tests kept)
  ui/
    app.js                # EDIT one line: source the transport from the preload API instead of pear-pipe
    bridge-ui.js          # REUSE unchanged
    qr.js, index.html, components/*  # REUSE unchanged (index.html: add CSP meta)
  test/
    transport-electron-ipc.test.js  # NEW
    transport-bare-ipc.test.js      # NEW
    (all existing test/*.test.js     # REUSE unchanged, stay green)
  DELETE: index.js, lib/pear-transport.js, ui/pear-transport.js, ui/tray.js
docs/notes/qa-desktop.md   # REWRITE for the Electron + OTA flow
```

---

## Task 1: Repackage as an Electron/electron-forge app (window opens, renderer↔main IPC proven)

**Files:**
- Rewrite: `desktop/package.json`
- Create: `desktop/forge.config.js`, `desktop/main.js` (minimal), `desktop/preload.js`
- Modify: `desktop/ui/index.html` (add CSP), `desktop/ui/app.js` (transport source — minimal)
- (manual-smoke deliverable: `npm run dev` opens a window and a preload round-trip works)

**Interfaces:**
- Produces: an electron-forge app that boots a `BrowserWindow` loading `ui/index.html`; a `preload.js` that exposes `window.bridgeTransport = { send, onMessage }` over `ipcRenderer`; a minimal `main.js` `ipcMain` echo to prove the channel. Consumed by Tasks 2–4.

> **Note:** because the core runs in a Bare worker (Task 2/3), the Electron app itself has NO native dependencies (preact/htm/qr are pure JS), so electron-forge packaging needs no native rebuild. Keep it that way — do not add native deps to the Electron side.

- [ ] **Step 1: Rewrite `desktop/package.json`**

```json
{
  "name": "pear-wallpaper-desktop",
  "productName": "Pear Wallpaper",
  "version": "0.1.0",
  "type": "commonjs",
  "main": "main.js",
  "scripts": {
    "start": "electron-forge start",
    "dev": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "test": "brittle test/*.test.js"
  },
  "dependencies": {
    "pear-wallpaper-core": "file:../core",
    "pear-runtime": "^3",
    "preact": "^10.24.0",
    "htm": "^3.1.1",
    "@paulmillr/qr": "^0.2.1"
  },
  "devDependencies": {
    "electron": "^33",
    "@electron-forge/cli": "^7",
    "@electron-forge/maker-zip": "^7",
    "brittle": "^3.19.0",
    "preact-render-to-string": "^6.5.0",
    "test-tmp": "^1.4.0"
  }
}
```

> Versions are best-effort; if `npm install` can't resolve one (e.g. `pear-runtime`'s major, or the electron/forge line), use the latest that installs cleanly and record every change. Confirm `pear-runtime`'s actual latest with `npm view pear-runtime version` first.

- [ ] **Step 2: Write `desktop/forge.config.js`**

```js
module.exports = {
  packagerConfig: { name: 'Pear Wallpaper', asar: true },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }]
}
```

- [ ] **Step 3: Write a minimal `desktop/main.js`** (window + echo; full wiring in later tasks)

```js
'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let win = null
function createWindow () {
  win = new BrowserWindow({
    width: 480,
    height: 660,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadFile('ui/index.html')
}

// Minimal echo so Task 1 can prove the preload transport before the worker exists.
ipcMain.on('bridge:to-main', (_evt, msg) => {
  if (win) win.webContents.send('bridge:to-renderer', { t: 'echo', got: msg })
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 4: Write `desktop/preload.js`** (contextBridge transport)

```js
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeTransport', {
  send: (msg) => ipcRenderer.send('bridge:to-main', msg),
  onMessage: (cb) => ipcRenderer.on('bridge:to-renderer', (_evt, msg) => cb(msg))
})
```

- [ ] **Step 5: Edit `desktop/ui/index.html`** — add a CSP meta so Electron doesn't warn, keep the module script:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' file: data:; style-src 'self' 'unsafe-inline'" />
    <title>Pear Wallpaper</title>
  </head>
  <body><div id="app"></div><script type="module" src="./app.js"></script></body>
</html>
```

- [ ] **Step 6: Edit `desktop/ui/app.js`** — swap the transport source (one region). Replace the `pear-pipe` import + `createBridgeUi(window.__pearTransport || createPearTransportUi())` line with the preload-exposed transport wrapped by the new renderer adapter (built in Task 4; for Task 1 use `window.bridgeTransport` directly so the app boots):

```js
// remove: import { createPearTransportUi } from './pear-transport.js'
// remove: import { createTray } from './tray.js'  (tray moves to main.js — Task 4)
const bridge = createBridgeUi(window.bridgeTransport)
```

Also remove the `import ui from 'pear-electron'` line and the whole `createTray({...})` block at the bottom (tray is a main-process concern now — Task 4). Leave the rest of `app.js` (routing, ErrorBanner, state handling) untouched.

- [ ] **Step 7: Install & static-check** — `cd desktop && npm install`; `node --check main.js preload.js`. Record any dependency version changes.

- [ ] **Step 8: Manual boot smoke (record for user)** — `cd desktop && npm run dev`. Expected: an Electron window opens rendering the Onboarding screen (it will fail to load real state until the worker exists — that's fine for Task 1; the window + preload channel are what's being proven). In the renderer devtools console, `window.bridgeTransport.send({t:'req',id:1,cmd:'ping'})` should produce a `bridge:to-renderer` echo. Document exact commands + expectations for the user; do not claim GUI verification you couldn't run headless.

- [ ] **Step 9: Commit**

```bash
git add desktop/package.json desktop/forge.config.js desktop/main.js desktop/preload.js desktop/ui/index.html desktop/ui/app.js
git commit -m "feat(desktop): repackage as electron-forge app with preload IPC"
```

---

## Task 2: Embed pear-runtime, launch the Bare worker, relay frames (PIN THE API)

**Files:**
- Create: `desktop/worker/core-host.js` (echo-only for this task), `desktop/lib/transport/bare-ipc.js`
- Modify: `desktop/main.js` (embed pear-runtime, launch worker, relay)
- (manual-smoke: a renderer→main→worker→renderer round-trip)

**Interfaces:**
- Produces: `main.js` launches the Bare worker via `pear-runtime` and relays frames between the renderer (`ipcMain`/`webContents.send`) and the worker (Bare IPC); `bare-ipc.js` exports `createBareTransport(endpoint): { send, onMessage }` honoring the bridge contract with newline-delimited JSON framing. Consumed by Task 3.

> **This is the load-bearing, version-specific integration.** START by reading the installed `pear-runtime` (`desktop/node_modules/pear-runtime/`, its README/package.json/exports) AND cloning/reading `holepunchto/hello-pear-electron` for the exact embedding pattern. Determine: (a) the `pear-runtime` constructor/factory and how it's initialized in an Electron main process; (b) how it launches a Bare worker (`pear.run('./worker/core-host.js', ...)` or equivalent) and what IPC handle that yields (`Bare.IPC` / a pipe / a port); (c) how the worker reads its side. **Report the real API in your report.** If you cannot make a minimal worker round-trip work, STOP and report BLOCKED with exactly what you found — do not fake it.

- [ ] **Step 1: Read the installed `pear-runtime` + `hello-pear-electron`** and note the real embedding + worker-launch + IPC API in your report.

- [ ] **Step 2: Write `desktop/lib/transport/bare-ipc.js`** (worker-side adapter; `endpoint` is the Bare IPC handle, injected for testability)

```js
'use strict'
// Worker-side transport over a Bare IPC endpoint. `endpoint` must expose
// `.on('data', cb)` and `.write(buf)` (a duplex stream / Bare pipe). Framing:
// newline-delimited JSON so concurrent sends never concatenate into one parse.
function createBareTransport (endpoint) {
  const handlers = []
  let buf = ''
  endpoint.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      for (const h of handlers) h(msg)
    }
  })
  return {
    send (m) { endpoint.write(Buffer.from(JSON.stringify(m) + '\n')) },
    onMessage (cb) { handlers.push(cb) }
  }
}
module.exports = { createBareTransport }
```

- [ ] **Step 3: Write an echo-only `desktop/worker/core-host.js`** to prove the round-trip (real core wiring is Task 3)

```js
'use strict'
// Bare worker entry. The exact way the worker obtains its IPC endpoint from
// pear-runtime is API-specific (see Task 2 Step 1) — wire `endpoint` to
// whatever pear-runtime hands the worker (e.g. Bare.IPC or a passed pipe),
// then adapt with createBareTransport.
const { createBareTransport } = require('../lib/transport/bare-ipc.js')

const endpoint = /* the Bare IPC handle from pear-runtime — adapt per Task 2 Step 1 */ require('bare-ipc-endpoint-TBD-per-step-1')
const transport = createBareTransport(endpoint)
transport.onMessage((msg) => {
  if (msg && msg.t === 'req') transport.send({ t: 'res', id: msg.id, ok: true, value: { echoedFromWorker: msg.cmd } })
})
```

> The `require(...)` for the endpoint is the one line you MUST replace with the real pear-runtime worker-IPC handle from Step 1. Everything else is concrete.

- [ ] **Step 4: Modify `desktop/main.js`** — embed pear-runtime, launch the worker, and relay frames. Replace the Task 1 echo `ipcMain.on(...)` with a relay: renderer→worker via `worker endpoint.write`, worker→renderer via `win.webContents.send('bridge:to-renderer', msg)`. Wire the pear-runtime + worker launch per Step 1; keep the relay logic concrete:

```js
// after createWindow(), once the worker endpoint `workerPipe` exists:
const { createBareTransport } = require('./lib/transport/bare-ipc.js')
// main relays: it does NOT parse bridge frames, just forwards them.
ipcMain.on('bridge:to-main', (_evt, msg) => { workerPipe.write(Buffer.from(JSON.stringify(msg) + '\n')) })
let rbuf = ''
workerPipe.on('data', (chunk) => {
  rbuf += chunk.toString('utf8')
  let i
  while ((i = rbuf.indexOf('\n')) !== -1) {
    const line = rbuf.slice(0, i); rbuf = rbuf.slice(i + 1)
    if (!line) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (win) win.webContents.send('bridge:to-renderer', msg)
  }
})
```

(`workerPipe` = the main-side handle of the worker's IPC duplex, from Step 1.)

- [ ] **Step 5: Manual round-trip smoke (record for user)** — `npm run dev`; in devtools, `window.bridgeTransport.send({t:'req',id:1,cmd:'ping'})` should yield a `{t:'res',...,value:{echoedFromWorker:'ping'}}` back, proving renderer→main→worker→renderer. Document for the user; report BLOCKED if the worker can't be launched.

- [ ] **Step 6: Commit** (`feat(desktop): embed pear-runtime + launch bare worker with frame relay`)

---

## Task 3: Wire the real core + bridge-main into the worker

**Files:**
- Modify: `desktop/worker/core-host.js` (replace echo with the real core), `desktop/main.js` (pass `storageDir` + the app executable path to the worker)
- (manual-smoke: window shows Onboarding with the real `deviceKey`; `getState` round-trips real data)

**Interfaces:**
- Consumes: `bridge-main.js`, `sync-engine.js`, `device-name.js`, `login-item.js`, `platform/index.js`, `WallpaperCore`, `bare-ipc.js`.
- Produces: a worker that boots the full core stack over Bare IPC. `main.js` passes `{ storageDir, exePath }` to the worker at launch (via pear-runtime's worker-arg/env mechanism).

- [ ] **Step 1: Modify `main.js`** to compute and pass config to the worker: `storageDir = app.getPath('userData')` and `exePath = app.getPath('exe')` (the `.app` executable, for the login-item target). Pass them to the worker per pear-runtime's worker-args/env API (from Task 2 Step 1). Add `app.dock` stays visible for now (Task 4 hides it). On `app.before-quit`/window teardown, signal the worker to close (a control frame or endpoint end) so `core.close()` runs.

- [ ] **Step 2: Rewrite `desktop/worker/core-host.js`** with the real stack (mirrors the old `index.js` boot, minus Pear specifics):

```js
'use strict'
const path = require('path')
const WallpaperCore = require('pear-wallpaper-core')
const { selectPlatform } = require('../lib/platform/index.js')
const { createLoginItem } = require('../lib/login-item.js')
const { createSyncEngine } = require('../lib/sync-engine.js')
const { createBridgeMain } = require('../lib/bridge-main.js')
const { resolveDeviceName } = require('../lib/device-name.js')
const { createBareTransport } = require('../lib/transport/bare-ipc.js')

// { storageDir, exePath } arrive from main via pear-runtime's worker args — adapt per Task 2 Step 1.
const { storageDir, exePath } = /* worker config from pear-runtime */ getWorkerConfigTBD()
const endpoint = /* Bare IPC handle from pear-runtime */ getWorkerEndpointTBD()

async function main () {
  const deviceName = resolveDeviceName({ storageDir })
  const core = new WallpaperCore({ storageDir, deviceName })
  await core.ready()

  const platform = selectPlatform()
  const engine = createSyncEngine({ core, platform })
  // Safety 'error' listener BEFORE start() (EventEmitter throws on zero-listener emit) — carried from the old boot.
  engine.on('error', (err) => console.error('[worker] sync-engine error', err))

  // Login-item now targets the built .app executable (no pear/pear:// link).
  const loginItem = createLoginItem({
    label: 'com.pear-wallpaper',
    programArguments: [exePath]
  })

  const transport = createBareTransport(endpoint)
  createBridgeMain({ core, platform, loginItem, engine, transport }).start()
  engine.start()

  // Close cleanly when main signals shutdown (adapt the signal per Task 2 Step 1).
  onWorkerShutdownTBD(async () => { engine.stop(); await core.close() })
}
main().catch((err) => { console.error('[worker] fatal', err) })
```

> Replace the three `*TBD*` calls with the real pear-runtime worker config/endpoint/shutdown mechanics from Task 2. Everything else is the concrete, reused stack.

- [ ] **Step 3: Manual smoke (record for user)** — `npm run dev`; window renders Onboarding; devtools `await window.bridgeTransport`-driven `getState` (or just observe the app's own `getState` call) returns a real `deviceKey`/`groupStatus:'none'`. Document for the user.

- [ ] **Step 4: Commit** (`feat(desktop): run core + bridge-main in the bare worker`)

---

## Task 4: Renderer transport adapter, tray, and window lifecycle

**Files:**
- Create: `desktop/lib/transport/electron-ipc.js`
- Modify: `desktop/ui/app.js` (use the adapter), `desktop/main.js` (Tray, close-hides, dock hide, single-instance)
- Delete: `desktop/ui/tray.js`
- Test: none new here beyond Task 7's adapter tests (this task is GUI wiring)

**Interfaces:**
- Produces: `createElectronTransport(api): { send, onMessage }` wrapping the preload-exposed `{send,onMessage}` (thin, but gives a testable seam + a place to normalize). `main.js` gains an Electron `Tray`, close-to-tray, `app.dock.hide()`, and `app.requestSingleInstanceLock()`.

- [ ] **Step 1: Write `desktop/lib/transport/electron-ipc.js`**

```js
'use strict'
// Renderer-side transport wrapping the preload-exposed endpoint
// (`window.bridgeTransport`). Kept as a module (not inlined) for a testable
// seam and to normalize the {send,onMessage} shape.
function createElectronTransport (api) {
  return { send: (m) => api.send(m), onMessage: (cb) => api.onMessage(cb) }
}
module.exports = { createElectronTransport }
```

> Note: this is CJS in `lib/`, but consumed by ESM `ui/app.js`. Import it in app.js via a static ESM import of the CJS module (Electron's renderer bundler/Node ESM interop handles `import { createElectronTransport } from '../lib/transport/electron-ipc.js'` for a CJS module through its default/named interop). If named import fails at runtime, import default and destructure. Confirm during Task 4 smoke and note which form worked.

- [ ] **Step 2: Edit `desktop/ui/app.js`** — build the bridge from the adapter:

```js
import { createElectronTransport } from '../lib/transport/electron-ipc.js'
const bridge = createBridgeUi(createElectronTransport(window.bridgeTransport))
```

- [ ] **Step 3: Add the Tray to `desktop/main.js`** (Electron `Tray`, main-process):

```js
const { Tray, Menu, nativeImage } = require('electron')
let tray = null
function createTray () {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'ui', 'trayTemplate.png')))
  const menu = Menu.buildFromTemplate([
    { label: 'Open Pear Wallpaper', click: () => { if (win) { win.show(); win.focus() } else createWindow() } },
    { label: 'Sync now', click: () => workerPipe.write(Buffer.from(JSON.stringify({ t: 'req', id: -1, cmd: 'syncNow', args: [] }) + '\n')) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setToolTip('Pear Wallpaper')
  tray.setContextMenu(menu)
}
```

- [ ] **Step 4: Close-to-tray + dock hide + single-instance in `main.js`:**

```js
// Menu-bar app: no dock icon.
app.whenReady().then(() => { if (app.dock) app.dock.hide() })

// Single instance: focus the existing window instead of launching a second app.
if (!app.requestSingleInstanceLock()) { app.quit() }
else app.on('second-instance', () => { if (win) { win.show(); win.focus() } })

// Closing the window hides it (keep worker/core running); real quit sets the flag.
function wireCloseToTray () {
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide() } })
}
// call createTray() and wireCloseToTray() after createWindow(); remove the
// window-all-closed→quit behavior (we stay resident in the tray).
```

- [ ] **Step 5: Delete `desktop/ui/tray.js`** (`git rm desktop/ui/tray.js`).

- [ ] **Step 6: Manual smoke (record for user)** — tray icon appears with Open/Sync now/Quit; closing the window hides it (app stays running, tray remains); Open re-shows; a second `npm run dev` focuses the existing window; Quit exits and tears down (worker closes core). Document for the user.

- [ ] **Step 7: Commit** (`feat(desktop): renderer transport adapter, tray, close-to-tray, single-instance`)

---

## Task 5: Login-item target + wake-from-sleep

**Files:**
- Modify: `desktop/main.js` (powerMonitor → worker syncNow)
- (login-item target already set in Task 3 Step 2 via `exePath`; this task verifies + adds wake)

**Interfaces:**
- Produces: `main.js` wires Electron `powerMonitor` `resume` → send a `syncNow` frame to the worker.

- [ ] **Step 1: Add powerMonitor wake to `main.js`:**

```js
const { powerMonitor } = require('electron')
app.whenReady().then(() => {
  powerMonitor.on('resume', () => {
    workerPipe.write(Buffer.from(JSON.stringify({ t: 'req', id: -2, cmd: 'syncNow', args: [] }) + '\n'))
  })
})
```

- [ ] **Step 2: Verify the login-item target** — confirm (by code inspection) the worker's `createLoginItem` uses `programArguments: [exePath]` where `exePath = app.getPath('exe')` passed from main, and that `login-item.js` is otherwise unchanged. No `pear`/`pear://` anywhere.

- [ ] **Step 3: Manual smoke (record for user)** — Settings → Launch at login ON → confirm `~/Library/LaunchAgents/com.pear-wallpaper.plist` exists and its `ProgramArguments` names the `.app` executable; toggling OFF removes it. Sleep/wake the Mac → a sync fires. (Login-at-login truly takes effect only for a built/installed `.app`, not `electron-forge start` — note this.) Document for the user.

- [ ] **Step 4: Commit** (`feat(desktop): wake-from-sleep sync + .app login-item target`)

---

## Task 6: OTA via pear-runtime (update-on-relaunch)

**Files:**
- Modify: `desktop/main.js` (pear-runtime update events → renderer), `desktop/package.json` (upgrade link config), `desktop/ui/components/Settings.js` (update affordance — small edit)
- (manual-smoke: stage an update; app detects it; applies on relaunch)

**Interfaces:**
- Produces: the app checks for updates in the background via `pear-runtime`, forwards `update-available`/`updated` to the renderer as a bridge `evt`, and Settings shows "Update available — restart to apply" + a restart button (`app.relaunch()`+`app.quit()` triggered via a bridge command relayed to main).

> Pin the exact `pear-runtime` OTA API (update-check, events, how the upgrade link is configured) against the installed package during Step 1 and report it.

- [ ] **Step 1: Configure the upgrade link** — run `pear touch` once (record the link), and set it in the app's pear-runtime config per the real API (Task 2 Step 1 established how pear-runtime is initialized; add the `upgrade`/link field). Document the link.

- [ ] **Step 2: Wire update events in `main.js`** — subscribe to pear-runtime's update lifecycle; on "update available/ready", send `{t:'evt',event:'update-ready',payload:{}}` to the renderer via the relay. Add an `ipcMain`/relay path for a `restartToUpdate` command → `app.relaunch(); app.quit()`.

- [ ] **Step 3: Edit `desktop/ui/components/Settings.js`** — add an update row that appears when an `update-ready` event has been received (MainView/app.js subscribes to the `update-ready` bridge event and threads it into the snapshot, e.g. `snapshot.updateReady`); render "Update available — restart to apply" + a button calling `bridge.call('restartToUpdate')`. Keep existing Settings content.

- [ ] **Step 4: Manual smoke (record for user)** — build/run one instance; from the dev machine `pear stage <link> .` a change and `pear seed <link>`; confirm the running app detects the update and applies it on relaunch. Document the exact `pear touch`/`stage`/`seed` commands for the user.

- [ ] **Step 5: Commit** (`feat(desktop): pear-runtime OTA with apply-on-relaunch`)

---

## Task 7: Transport adapter unit tests + delete dead files

**Files:**
- Create: `desktop/test/transport-electron-ipc.test.js`, `desktop/test/transport-bare-ipc.test.js`
- Delete: `desktop/lib/pear-transport.js`, `desktop/ui/pear-transport.js` (and `ui/tray.js` if not already), `desktop/index.js`
- (full suite green)

**Interfaces:** consumes `lib/transport/*`. Tests use fake endpoints; no Electron/Bare.

- [ ] **Step 1: Write `desktop/test/transport-bare-ipc.test.js`**

```js
const test = require('brittle')
const { EventEmitter } = require('events')
const { createBareTransport } = require('../lib/transport/bare-ipc.js')

function fakeEndpoint () {
  const ee = new EventEmitter()
  return Object.assign(ee, { written: [], write (b) { this.written.push(b.toString('utf8')) } })
}

test('bare transport frames sends as newline-delimited JSON', (t) => {
  const ep = fakeEndpoint(); const tr = createBareTransport(ep)
  tr.send({ t: 'req', id: 1, cmd: 'x' })
  t.is(ep.written[0], '{"t":"req","id":1,"cmd":"x"}\n')
})

test('bare transport parses concatenated + split frames, drops malformed', (t) => {
  const ep = fakeEndpoint(); const tr = createBareTransport(ep)
  const got = []; tr.onMessage((m) => got.push(m))
  ep.emit('data', Buffer.from('{"a":1}\n{"b":2}\n'))      // two in one chunk
  ep.emit('data', Buffer.from('{"c":'))                    // split frame...
  ep.emit('data', Buffer.from('3}\n'))                     // ...completed
  ep.emit('data', Buffer.from('not-json\n'))               // malformed → dropped
  t.alike(got, [{ a: 1 }, { b: 2 }, { c: 3 }])
})
```

- [ ] **Step 2: Run it (RED → implement already exists → GREEN)** — `cd desktop && npx brittle test/transport-bare-ipc.test.js`. Expected: PASS (the module exists from Task 2). If RED for a real reason, fix the module.

- [ ] **Step 3: Write `desktop/test/transport-electron-ipc.test.js`**

```js
const test = require('brittle')
const { createElectronTransport } = require('../lib/transport/electron-ipc.js')

test('electron transport forwards send + onMessage to the injected api', (t) => {
  const sent = []; let handler = null
  const api = { send: (m) => sent.push(m), onMessage: (cb) => { handler = cb } }
  const tr = createElectronTransport(api)
  tr.send({ t: 'req', id: 1 }); t.alike(sent, [{ t: 'req', id: 1 }])
  const got = []; tr.onMessage((m) => got.push(m)); handler({ t: 'evt', event: 'state' })
  t.alike(got, [{ t: 'evt', event: 'state' }])
})
```

- [ ] **Step 4: Run it** — `cd desktop && npx brittle test/transport-electron-ipc.test.js`. Expected: PASS.

- [ ] **Step 5: Delete dead Pear-era files** — `git rm desktop/lib/pear-transport.js desktop/ui/pear-transport.js desktop/index.js` (and `desktop/ui/tray.js` if Task 4 didn't). Grep to confirm nothing imports them: `grep -rn "pear-transport\|pear-electron\|pear-bridge\|pear-pipe" desktop --include=*.js -l | grep -v node_modules` must be empty.

- [ ] **Step 6: Full suite** — `cd desktop && npm test`. Expected: all `test/*.test.js` pass, pristine (the reused 45 + the 2 new adapter tests). Record the count.

- [ ] **Step 7: Commit** (`test(desktop): transport adapter tests; remove dead pear-electron files`)

---

## Task 8: QA script, docs, and final green

**Files:**
- Rewrite: `docs/notes/qa-desktop.md`
- Modify: `docs/notes/JOURNAL.md`, `desktop/README.md`

- [ ] **Step 1: Full automated suite** — `cd desktop && npm test`; confirm green + pristine; record N tests / M asserts. If red, STOP and report (don't patch reused logic here).

- [ ] **Step 2: Rewrite `docs/notes/qa-desktop.md`** for the Electron + worker + OTA flow. Cover: `npm run dev` boot; renderer↔main↔worker `getState` round-trip; two instances (build the `.app` or run two `userData` dirs — document how); create/invite/QR/approve pairing; send both directions with the `File.path`/`getPathForFile` path + macOS Automation grant + wallpaper change; close-to-tray background apply; sleep/wake; tray Open/Sync/Quit; single-instance focus; Launch-at-login against a built `.app`; **OTA** (`pear touch`/`stage`/`seed` → detect → apply on relaunch); revoke → lockout; re-apply.

- [ ] **Step 3: Update `docs/notes/JOURNAL.md`** — append the pivot entry: pear-electron archived + `pear run` removed (spike), the Electron + pear-runtime + Bare-worker architecture, what was reused vs rewritten, the transport-agnostic bridge paying off, and deferred items.

- [ ] **Step 4: Rewrite `desktop/README.md`** — Electron dev (`npm run dev`), package/make, the three-tier architecture, the OTA workflow, and the testing split (automated logic vs manual GUI/OTA smoke).

- [ ] **Step 5: Commit** (`docs(desktop): QA script, journal, README for electron+pear-runtime`)

---

## Self-Review (completed by plan author)

**Spec coverage:** §0 pivot rationale → carried in plan intro + Task ordering. §1 decisions → Tasks 1 (electron-forge), 2 (bare worker via pear-runtime), 4 (tray/background), 6 (OTA), 3 (read-only name via reused device-name), constraints (no electron-rebuild → core in worker). §2 three-tier model → Tasks 1–4. §3 login-item target → Tasks 3/5. §4 bridge vocabulary → reused (constraints + Task 3). §5 module structure → file-structure section + tasks. §6 UI → reused (Task 1 app.js edit; Task 6 Settings edit). §7 sync engine + single-instance(Electron) + powerMonitor → Tasks 3/4/5. §8 storage(userData)/distribution/OTA → Tasks 3/6. §9 testing → Task 7 (adapters) + reused suite + Task 8 (QA). §10 non-goals → respected.

**Placeholder scan:** the only intentionally-unresolved items are the `*TBD*` pear-runtime worker-endpoint/config/shutdown hooks in Tasks 2–3 — these are flagged as "pin against the installed package + hello-pear-electron and report," with concrete code around them, because the exact API is version-specific and cannot be honestly hard-coded blind (same approach the prior plan used for pear-electron). Every other step has concrete content. No "TODO/handle errors/similar-to-N".

**Type/interface consistency:** transport contract `{send,onMessage}` + wire protocol identical across `bare-ipc.js`, `electron-ipc.js`, the main relay, and the reused bridge; `createBridgeMain`/`createBridgeUi` signatures match the reused modules; storageDir/exePath threading from main→worker is consistent (Tasks 3/5); login-item `programArguments:[exePath]` consistent between Task 3 (set) and Task 5 (verify).

**Risk note:** Tasks 2 and 6 are the load-bearing, version-specific integrations; both explicitly report the real API and can return BLOCKED rather than fabricate. If Task 2 can't launch a worker round-trip, the whole topology assumption fails and the controller re-scopes before Task 3+.
