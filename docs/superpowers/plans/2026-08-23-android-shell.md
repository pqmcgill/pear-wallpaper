# Android Shell Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app (Expo/RN UI + `pear-wallpaper-core` in a bare-kit worklet) that pairs into a group, receives and applies wallpapers, sends from the share sheet, and syncs opportunistically in the background.

**Architecture:** Same three tiers as desktop with the process boundary swapped for a thread boundary: RN UI ⇄ `bridge-ui` ⇄ shared duplex-JSON transport over `BareKit.IPC` ⇄ `bridge-main` + core in a Bare worklet. The protocol layer lifts out of `desktop/` into a shared `bridge/` package first. Apply is inverted on Android: the worklet surfaces pending wallpapers; the RN side runs the native setter and acks.

**Tech Stack:** react-native-bare-kit 0.15.0 (pinned exact), bare-pack (`--linked`), Expo SDK 55 / RN 0.83 (from the `holepunchto/bare-expo` template), expo-router, expo-camera, expo-share-intent, expo-background-task, a local Kotlin Expo Module for `WallpaperManager`, b4a, brittle (worklet-side tests), jest + jest-expo + @testing-library/react-native (RN-side tests).

**Spec:** `docs/superpowers/specs/2026-08-23-android-shell-design.md`

## The Learning Loop (project workflow)

Same as Plans 1–2 — executed one task at a time as **teachable units**:

1. A fresh subagent implements the task exactly as written (TDD steps).
2. The main thread presents the diff as a walkthrough against the task's **Learning goal**; Patrick reviews and asks questions before the next task starts.
3. Tangents go to a side session that ends by writing `docs/notes/<topic>.md` (≤10 lines + decisions); the main thread reads only that file.
4. Each completed task gets one line in `docs/notes/JOURNAL.md`.
5. Each task ends with an **Understanding checkpoint** the walkthrough is built around.

## Global Constraints

- **Branch:** execute on `android-shell`, cut from `main` after `desktop-shell` merges (confirm the merge with Patrick at execution start; do not merge unasked).
- **Pin exact versions** (no `^`/`~`) for `react-native-bare-kit`, `bare-pack`, and every Bare-side package. Expo-managed packages are installed with `npx expo install <pkg>` (SDK-compatible resolution) and then pinned exact in `package.json`. Upgrades are deliberate tasks, never incidental; each upgrade re-tests suspend/resume.
- **No Expo Go.** CNG only: `npx expo run:android`. `newArchEnabled: true`, Android `minSdkVersion 31`, `useLegacyPackaging: true` (required by `bare-link`'s `.so` packaging).
- **Plain JavaScript, not TypeScript** — matches the rest of the repo. Strip or convert template TS files as they're touched.
- **One test runner per runtime:** brittle wherever Bare/Node is the runtime (`bridge/`, `android/worklet/`), jest + jest-expo wherever RN is (`android/app/`, `android/lib/`).
- **The dev-loop trap:** Metro hot-reloads only the RN side. Any change under `android/worklet/`, `core/`, or `bridge/` requires `npm run bundle:worklet` before it exists on the device. Every task's QA steps that touch worklet code repeat this.
- **Single-writer storage:** at most one worklet may have the corestore open at a time. The RN-side worklet client is a module-level singleton; the background task no-ops when the app is active (Task 9).
- **API divergences:** installed `node_modules` source is ground truth over this plan's code sketches (the react-native-bare-kit / bare-expo APIs move). When reality disagrees with a step, follow reality and record the divergence in `docs/notes/api-divergences.md` — same protocol as Plans 1–2.
- Every task: tests first, watch them fail, implement, watch them pass, commit. All suites green at every commit: `cd bridge && npm test`, `cd desktop && npm test`, and (from Task 2 on) `cd android && npm run test:worklet && npm run test:ui`.

## File Structure

```
bridge/                       — NEW shared package `pear-wallpaper-bridge` (Task 1)
  package.json                — exports map; CJS default, bridge-ui as .mjs
  bridge-main.js              — lifted from desktop/lib; platform/loginItem/engine now optional;
                                + pendingWallpaper/markApplied commands
  bridge-ui.mjs               — lifted from desktop/ui/bridge-ui.js (ESM ⇒ .mjs in a CJS package)
  sync-engine.js              — lifted from desktop/lib; applyPending no-ops when platform == null
  transport/duplex-json.js    — lifted from desktop/lib/transport/bare-ipc.js, b4a-ified
                                (same adapter serves Bare worker, worklet, AND RN sides)
  test/                       — the four moved desktop test files + new optionality tests
android/                      — NEW Expo app, scaffolded from holepunchto/bare-expo (Task 2)
  package.json                — pinned deps; bundle:worklet, test:worklet, test:ui scripts
  app.json                    — name/slug/android.package; expo-build-properties (minSdk 31,
                                useLegacyPackaging); plugins grow in Tasks 6/8/9
  metro.config.js             — watchFolders for ../bridge and ../core (file: symlink deps)
  app/                        — expo-router routes: _layout.js, index.js (router by groupStatus),
                                send.js (Task 8)
  app/gen/worklet.bundle.mjs  — bare-pack output (gitignored)
  lib/worklet-client.js       — RN-side singleton: start worklet, init frame, bridge-ui wiring
  lib/store.js                — snapshot reducer + React context (desktop app.js state model)
  lib/apply-controller.js     — wallpaper evt → pendingWallpaper → setter → markApplied
  lib/settings.js             — tiny JSON settings file (lock-screen toggle)
  components/                 — Onboarding, Waiting, MainView, DeviceList, Received, Settings,
                                ErrorBanner (RN ports of the desktop components' logic)
  worklet/core-host.js        — Bare entry: wires BareKit.IPC to createCoreHost
  worklet/host.js             — createCoreHost({transport}) — testable seam (init frame → core →
                                engine → bridge-main)
  modules/wallpaper-setter/   — local Kotlin Expo Module (Task 6)
  test-worklet/               — brittle tests for worklet/host.js (Node runtime)
  test/                       — jest tests for lib/ + components/
desktop/                      — Task 1 removes lifted files, updates imports + import map
docs/notes/qa-android.md      — manual QA script, written incrementally per task (Task 4 onward)
```

---

### Task 1: Lift the bridge into `bridge/` (shared package)

**Learning goal:** How a protocol layer becomes a package: exports maps as the public seam, why one file is `.mjs` in a CJS package (three consumers, three module systems: Node `require`, browser import map, Metro), and why the transport switches from `Buffer` to `b4a` (the same bytes API exists in Bare, Node, and RN).

**Files:**
- Create: `bridge/package.json`, `bridge/test/bridge-main-optional.test.js`
- Move (git mv, then edit): `desktop/lib/bridge-main.js → bridge/bridge-main.js`, `desktop/ui/bridge-ui.js → bridge/bridge-ui.mjs`, `desktop/lib/sync-engine.js → bridge/sync-engine.js`, `desktop/lib/transport/bare-ipc.js → bridge/transport/duplex-json.js`, and their tests `desktop/test/{bridge-main,bridge-ui,sync-engine,transport-bare-ipc}.test.js → bridge/test/` (transport test renamed `transport-duplex-json.test.js`)
- Modify: `desktop/package.json`, `desktop/worker/core-host.js`, `desktop/ui/app.js`, `desktop/ui/index.html` (import map + CSP hash), `desktop/README.md` (paths + test counts)

**Interfaces:**
- Produces (consumed by every later task):
  - `require('pear-wallpaper-bridge/main')` → `{ createBridgeMain({ core, transport, engine = null, platform = null, loginItem = null }) }` — `pendingWallpaper()`/`markApplied(id)` commands always registered; `reapply` only when `platform`, `setLoginAtLogin` only when `loginItem`, `syncNow` only when `engine`; snapshot's `loginAtLogin` key present only when `loginItem`, `lastSync` is `engine ? engine.lastSync : null`.
  - `import { createBridgeUi } from 'pear-wallpaper-bridge/ui'` — unchanged API (`call`, `on`).
  - `require('pear-wallpaper-bridge/engine')` → `{ createSyncEngine({ core, platform = null, intervalMs }) }` — `applyPending()` returns immediately when `platform` is null (Android: apply is RN-side, spec §3.2).
  - `require('pear-wallpaper-bridge/transport')` → `{ createDuplexJsonTransport(endpoint) }` — newline-JSON framing over anything with `.on('data')`/`.write()`; b4a-based so it runs under Bare, Node, and RN.

- [ ] **Step 1: Scaffold the package.** Check the repo's existing versions first — `cd desktop && npm ls b4a brittle test-tmp` (b4a comes in transitively via core's stack) — and use those exact versions below. Create `bridge/package.json`:

```json
{
  "name": "pear-wallpaper-bridge",
  "version": "0.1.0",
  "type": "commonjs",
  "exports": {
    "./main": "./bridge-main.js",
    "./ui": "./bridge-ui.mjs",
    "./engine": "./sync-engine.js",
    "./transport": "./transport/duplex-json.js"
  },
  "scripts": { "test": "brittle test/*.test.js" },
  "dependencies": { "b4a": "<exact version from desktop lockfile>" },
  "devDependencies": { "brittle": "<exact>", "test-tmp": "<exact>" }
}
```

- [ ] **Step 2: git mv the four modules and four test files** per the Files list. `cd bridge && npm install`. Fix the moved tests' relative requires (`../lib/bridge-main.js` → `../bridge-main.js`, etc.). In the moved `bridge-ui` test, the dynamic import becomes `await import('../bridge-ui.mjs')`.

- [ ] **Step 3: b4a-ify the transport.** In `bridge/transport/duplex-json.js`, rename the export to `createDuplexJsonTransport` and replace the two Buffer touches:

```js
'use strict'
// Newline-JSON framing over any duplex endpoint exposing .on('data') and
// .write(). Uses b4a (not Buffer) so the identical module runs under Bare
// (desktop worker, Android worklet) and RN's JS runtime (worklet.IPC on the
// UI side) — Buffer is not a global in RN.
const b4a = require('b4a')
function createDuplexJsonTransport (endpoint) {
  const handlers = []
  let buf = ''
  endpoint.on('data', (chunk) => {
    buf += b4a.toString(chunk, 'utf8')
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
    send (m) { endpoint.write(b4a.from(JSON.stringify(m) + '\n')) },
    onMessage (cb) { handlers.push(cb) }
  }
}
module.exports = { createDuplexJsonTransport }
```

Update the moved transport test's import/name accordingly.

- [ ] **Step 4: Write the failing optionality tests** — `bridge/test/bridge-main-optional.test.js`:

```js
const test = require('brittle')
const { createBridgeMain } = require('pear-wallpaper-bridge/main')

function fakeTransport () {
  const sent = []; const handlers = []
  return {
    sent,
    send: (m) => sent.push(m),
    onMessage: (cb) => handlers.push(cb),
    inject: (m) => handlers.forEach((h) => h(m))
  }
}
function fakeCore () {
  const calls = []
  return {
    calls,
    deviceKey: 'k', deviceName: 'n', groupStatus: 'member',
    on: () => {},
    listDevices: async () => [], listSends: async () => [], listReceived: async () => [],
    pendingWallpaper: async () => { calls.push('pendingWallpaper'); return { id: 'w1', filePath: '/tmp/w1.jpg' } },
    markApplied: async (id) => { calls.push(['markApplied', id]) }
  }
}

test('pendingWallpaper and markApplied are bridge commands', async (t) => {
  const tr = fakeTransport(); const core = fakeCore()
  createBridgeMain({ core, transport: tr }).start()
  tr.inject({ t: 'req', id: 1, cmd: 'pendingWallpaper', args: [] })
  tr.inject({ t: 'req', id: 2, cmd: 'markApplied', args: ['w1'] })
  await new Promise((r) => setImmediate(r))
  const res1 = tr.sent.find((m) => m.t === 'res' && m.id === 1)
  const res2 = tr.sent.find((m) => m.t === 'res' && m.id === 2)
  t.alike(res1.value, { id: 'w1', filePath: '/tmp/w1.jpg' })
  t.ok(res2.ok)
  t.alike(core.calls[1], ['markApplied', 'w1'])
})

test('optional deps: absent loginItem/engine/platform degrade, not crash', async (t) => {
  const tr = fakeTransport()
  createBridgeMain({ core: fakeCore(), transport: tr }).start()
  tr.inject({ t: 'req', id: 1, cmd: 'getState', args: [] })
  tr.inject({ t: 'req', id: 2, cmd: 'setLoginAtLogin', args: [true] })
  tr.inject({ t: 'req', id: 3, cmd: 'reapply', args: ['w1'] })
  tr.inject({ t: 'req', id: 4, cmd: 'syncNow', args: [] })
  await new Promise((r) => setImmediate(r))
  const snap = tr.sent.find((m) => m.id === 1).value
  t.is(snap.lastSync, null)
  t.ok(!('loginAtLogin' in snap), 'loginAtLogin key omitted without loginItem')
  for (const id of [2, 3, 4]) {
    const r = tr.sent.find((m) => m.id === id)
    t.is(r.ok, false)
    t.ok(/unknown command/.test(r.error))
  }
})
```

- [ ] **Step 5: Run to verify failure.** `cd bridge && npm test` — the optionality tests must fail (commands missing / snapshot crashes on `loginItem.isEnabled`).

- [ ] **Step 6: Implement in `bridge/bridge-main.js`.** Signature `({ core, transport, engine = null, platform = null, loginItem = null })`. Snapshot:

```js
  async function snapshot () {
    const inGroup = core.groupStatus === 'member'
    const snap = {
      deviceKey: core.deviceKey,
      deviceName: core.deviceName,
      groupStatus: core.groupStatus,
      roster: inGroup ? await core.listDevices() : [],
      sends: inGroup ? await core.listSends() : [],
      received: inGroup ? await core.listReceived() : [],
      lastSync: engine ? engine.lastSync : null
    }
    // Key omitted (not null) when the shell has no login-item concept
    // (Android): the UI treats "absent" as "don't render the toggle".
    if (loginItem) snap.loginAtLogin = await loginItem.isEnabled()
    return snap
  }
```

Commands: keep the existing eight; add unconditionally `pendingWallpaper: () => core.pendingWallpaper()` and `markApplied: (wallpaperId) => core.markApplied(wallpaperId)`; spread-guard the shell-specific three:

```js
    ...(engine ? { syncNow: () => engine.syncNow() } : {}),
    ...(platform ? { reapply } : {}),
    ...(loginItem ? { setLoginAtLogin: (on) => (on ? loginItem.enable() : loginItem.disable()) } : {})
```

In `start()`, guard the engine wiring: `if (engine && engine.on) { engine.on('error', ...); engine.on('applied', safePushState) }`.

In `bridge/sync-engine.js`, first line of `applyPending`: `if (!platform) return // Android: apply is RN-side (spec §3.2); the sync loop still runs`, and default the param `platform = null`.

- [ ] **Step 7: Run to verify pass.** `cd bridge && npm test` — all files green (the four moved suites + the new one).

- [ ] **Step 8: Rewire desktop.** `desktop/package.json` deps += `"pear-wallpaper-bridge": "file:../bridge"`; `cd desktop && npm install`. `worker/core-host.js`: requires become `require('pear-wallpaper-bridge/main')`, `.../engine`, `.../transport'` with `createDuplexJsonTransport` (variable rename included). `ui/app.js`: `import { createBridgeUi } from 'pear-wallpaper-bridge/ui'`. `ui/index.html`: import map gains `"pear-wallpaper-bridge/ui": "../node_modules/pear-wallpaper-bridge/bridge-ui.mjs"`; regenerate the CSP hash with the one-liner documented in the file. Delete nothing else — `ui/electron-ipc.js` stays (renderer-specific).

- [ ] **Step 9: Verify desktop.** `cd desktop && npm test` — green (the moved files no longer run here; `renderer-modules.test.js` now enforces the new import-map entry and the fresh hash). Then boot the real app: `ELECTRON_ENABLE_LOGGING=1 npx electron .` — window renders Onboarding, no renderer console errors — quit via tray.

- [ ] **Step 10: Docs + commit.** Update `desktop/README.md` (moved paths, new package, test counts). One JOURNAL.md line. Commit: `refactor(bridge): lift bridge/engine/transport into shared pear-wallpaper-bridge package`.

**Understanding checkpoint:** You can explain why `bridge-ui` had to become `.mjs` while its three siblings stayed `.js`; what each of the three consumers (desktop worker, desktop renderer, future RN app) resolves the package through (Node exports map, browser import map, Metro); and why `pendingWallpaper`/`markApplied` belong to the shared command table while `reapply`/`setLoginAtLogin` are conditional.

---

### Task 2: Scaffold `android/` from bare-expo; worklet echo on the emulator

**Learning goal:** What bare-kit actually is on Android — a TurboModule hosting a Bare thread — and what the template buys: autolinking, `.so` packaging, the worklet echo pattern, logcat visibility. Plus the CNG build loop (`expo run:android`) and why Expo Go can never run this app.

**Files:**
- Create: `android/` (template import, trimmed), `android/metro.config.js`, `android/jest.config.js`, `android/test/smoke.test.js`
- Modify: root `.gitignore` (android build dirs, `android/app/gen/`)

**Interfaces:**
- Produces: a booting Expo app with `react-native-bare-kit` linked and a proven RN⇄worklet IPC round trip; jest wired (`npm run test:ui`).

- [ ] **Step 1: Import the template.**

```bash
git clone --depth 1 https://github.com/holepunchto/bare-expo /tmp/bare-expo-template
rsync -a --exclude .git /tmp/bare-expo-template/ android/
cd android && npm install
```

Read the template's README and its app entry before changing anything — its worklet-echo example and bundling setup are the reference implementation for this whole plan. Record any drift from this plan's sketches in `docs/notes/api-divergences.md`.

- [ ] **Step 2: Make it ours.** `app.json`: `name: "Pear Wallpaper"`, `slug: "pear-wallpaper"`, `android.package: "com.pearwallpaper.app"`; confirm (they come from the template) `newArchEnabled: true` and `expo-build-properties` with `minSdkVersion: 31`, `useLegacyPackaging: true` — add them if the template has moved on. Pin `react-native-bare-kit` exact (whatever the template installed — expect 0.15.x). Convert any template TS entry files you touch to JS. Trim the template's example UI down to one screen that runs its worklet echo (Text shows the worklet's reply).

- [ ] **Step 3: Metro + git hygiene.** `metro.config.js`: extend the template/Expo default with `watchFolders: [path.resolve(__dirname, '../bridge'), path.resolve(__dirname, '../core')]` (file:-dep symlinks land in Tasks 3–4; Metro must watch their real paths). Root `.gitignore` += `android/app/gen/` plus the template's native build dirs if its own `.gitignore` didn't come across.

- [ ] **Step 4: Boot on the emulator.** Emulator running, then `npx expo run:android`. Expect: Gradle build succeeds, app opens, the echo screen shows the worklet's reply, and `adb logcat -s bare` shows worklet-side console output. This is the go/no-go gate for the whole stack — do not proceed past a failure here; debug it (record findings).

- [ ] **Step 5: Wire jest.** Add `jest-expo`, `jest`, `@testing-library/react-native` (via `npx expo install` where applicable, then pin). `jest.config.js`: `{ preset: 'jest-expo' }`. `android/test/smoke.test.js`: render the echo screen with a mocked `react-native-bare-kit` (`jest.mock` returning a fake `Worklet` with a no-op `start` and a fake `IPC`) and assert it renders without the native module. Scripts: `"test:ui": "jest"`.

- [ ] **Step 6: Run tests, commit.** `npm run test:ui` green. JOURNAL line. Commit: `feat(android): scaffold Expo app from bare-expo; worklet echo verified on emulator`.

**Understanding checkpoint:** You can trace a byte from RN's `worklet.IPC.write` to the worklet's `BareKit.IPC` 'data' event and name the layer each hop crosses; explain why this app requires CNG (native TurboModule ⇒ no Expo Go); and say what `useLegacyPackaging` changes about the APK and which package (`bare-link`) needs it.

---

### Task 3: Worklet host (`createCoreHost`) + bare-pack pipeline

**Learning goal:** The init-frame contract — why config crosses the IPC as a message instead of argv (no sidecar spawn here), and how factoring `host.js` from the 6-line Bare entry makes the whole worklet testable in Node against the real core.

**Files:**
- Create: `android/worklet/host.js`, `android/worklet/core-host.js`, `android/test-worklet/host.test.js`
- Modify: `android/package.json` (deps: `pear-wallpaper-core` + `pear-wallpaper-bridge` as `file:../`, `b4a`; devDeps: `bare-pack`, `brittle`, `test-tmp` — all pinned; scripts: `bundle:worklet`, `test:worklet`, `android`)

**Interfaces:**
- Consumes: Task 1's `createBridgeMain` / `createSyncEngine` / `createDuplexJsonTransport` exact signatures.
- Produces: worklet protocol — first inbound frame must be `{ t: 'init', storageDir, deviceName, intervalMs? }`; host replies `{ t: 'evt', event: 'ready' }` (or `event: 'error'` with `{ message }`), then speaks standard bridge frames; `{ t: 'shutdown' }` closes engine+core and calls `exit()`. Consumed by Tasks 4 and 9.

- [ ] **Step 1: Write the failing test** — `android/test-worklet/host.test.js`:

```js
const test = require('brittle')
const tmp = require('test-tmp')
const { createCoreHost } = require('../worklet/host.js')
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')

// In-memory duplex pair standing in for BareKit.IPC's two ends.
function duplexPair () {
  const { EventEmitter } = require('events')
  const a = new EventEmitter(); const b = new EventEmitter()
  a.write = (buf) => setImmediate(() => b.emit('data', buf))
  b.write = (buf) => setImmediate(() => a.emit('data', buf))
  return [a, b]
}

test('init frame boots the real core; bridge answers; shutdown exits', async (t) => {
  t.plan(4)
  const [workletEnd, rnEnd] = duplexPair()
  let exited = false
  createCoreHost({ transport: createDuplexJsonTransport(workletEnd), exit: () => { exited = true } })

  const rn = createDuplexJsonTransport(rnEnd)
  const { createBridgeUi } = await import('pear-wallpaper-bridge/ui')
  const bridge = createBridgeUi(rn)
  const ready = new Promise((resolve) => bridge.on('ready', resolve))
  rn.send({ t: 'init', storageDir: await tmp(t), deviceName: 'test-droid' })
  await ready
  t.pass('ready event received')

  const snap = await bridge.call('getState')
  t.is(snap.groupStatus, 'none')
  t.is(snap.deviceName, 'test-droid')

  rn.send({ t: 'shutdown' })
  await new Promise((r) => setTimeout(r, 500))
  t.ok(exited, 'shutdown closed core and called exit')
})
```

- [ ] **Step 2: Run to verify failure.** `cd android && npm run test:worklet` (add the script first: `"test:worklet": "brittle test-worklet/*.test.js"`). Expected: cannot find `../worklet/host.js`.

- [ ] **Step 3: Implement `android/worklet/host.js`:**

```js
'use strict'
// Runtime-agnostic worklet host: everything core-host.js does except touch
// the BareKit/Bare globals, so brittle can drive it in Node with an
// in-memory duplex and the REAL core. Config arrives as an init frame, not
// argv — there is no sidecar spawn on Android; the RN side owns storageDir
// (app files dir) and deviceName and must send init before any bridge
// traffic (worklet-client.js does).
const WallpaperCore = require('pear-wallpaper-core')
const { createBridgeMain } = require('pear-wallpaper-bridge/main')
const { createSyncEngine } = require('pear-wallpaper-bridge/engine')

function createCoreHost ({ transport, exit = () => {} }) {
  let started = false
  let core = null
  let engine = null
  transport.onMessage(async (msg) => {
    if (!msg) return
    if (msg.t === 'init' && !started) {
      started = true
      try {
        core = new WallpaperCore({ storageDir: msg.storageDir, deviceName: msg.deviceName })
        await core.ready()
        // platform:null — apply is RN-side on Android (spec §3.2); the
        // engine still gives us the periodic sync loop + syncNow + lastSync.
        engine = createSyncEngine({ core, platform: null, intervalMs: msg.intervalMs || 180000 })
        // Safety listener: sync-engine throws on 'error' with zero listeners
        // (same rationale as desktop/worker/core-host.js).
        engine.on('error', () => {})
        createBridgeMain({ core, engine, transport }).start()
        engine.start()
        transport.send({ t: 'evt', event: 'ready', payload: {} })
      } catch (err) {
        transport.send({ t: 'evt', event: 'error', payload: { message: err.message } })
      }
      return
    }
    // Message-level shutdown, mirroring desktop: used by Task 9's bounded
    // background rounds so corestore closes cleanly before terminate().
    if (msg.t === 'shutdown') {
      try { if (engine) engine.stop(); if (core) await core.close() } catch {} finally { exit() }
    }
  })
}
module.exports = { createCoreHost }
```

And `android/worklet/core-host.js`:

```js
/* global BareKit, Bare */
'use strict'
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')
const { createCoreHost } = require('./host.js')
createCoreHost({
  transport: createDuplexJsonTransport(BareKit.IPC),
  exit: () => Bare.exit()
})
```

- [ ] **Step 4: Run to verify pass.** `cd android && npm run test:worklet` — green (this exercises the real corestore/autobase stack in-process; first run may be slow).

- [ ] **Step 5: The bundle pipeline.** Scripts:

```json
"bundle:worklet": "bare-pack --linked --host android-arm64 --host android-x64 --out app/gen/worklet.bundle.mjs worklet/core-host.js",
"android": "npm run bundle:worklet && expo run:android"
```

Run `npm run bundle:worklet` — it must resolve `pear-wallpaper-core`/`-bridge` through the `file:` symlinks and rewrite `sodium-native`/`udx-native` requires to `linked:` specifiers (inspect the bundle header to confirm; record divergences if bare-pack needs flags for symlinked deps).

- [ ] **Step 6: Commit.** JOURNAL line. Commit: `feat(android): worklet core-host with init-frame contract; bare-pack pipeline`.

**Understanding checkpoint:** You can explain the full init handshake (who sends what, in what order, and why bridge traffic before `ready` would be wrong); why `platform: null` is how the apply-inversion reaches the engine; and what `--linked` did to the two native requires in the generated bundle.

---

### Task 4: RN shell — worklet client, snapshot store, routing (milestone: Onboarding on emulator via real core)

**Learning goal:** Desktop's renderer state model transplanted to React: one snapshot, events fold in, UI is a pure function — and the RN-side lifecycle duties the desktop renderer never had (starting the worklet, AppState suspend/resume).

**Files:**
- Create: `android/lib/worklet-client.js`, `android/lib/store.js`, `android/components/{Onboarding,Waiting,MainView,ErrorBanner}.js`, `android/app/_layout.js`, `android/app/index.js`, `android/test/{store,worklet-client,onboarding}.test.js`, `docs/notes/qa-android.md` (Act 1)
- Modify: delete the template echo screen; `android/package.json` (add `expo-device` via `npx expo install`, pin)

**Interfaces:**
- Consumes: Task 3's init-frame protocol; Task 1's `createBridgeUi`/`createDuplexJsonTransport`.
- Produces: `getBridge()` (module-level singleton — the single-writer rule's first enforcement point), `getWorklet()`; `reduce(snapshot, action)` with actions `{type:'state'|'error'|'dismiss-error', payload}`; a `SnapshotContext` provider in `_layout.js`. Consumed by every later UI task.

- [ ] **Step 1: Failing tests first.** `android/test/store.test.js`:

```js
import { reduce, initialSnapshot } from '../lib/store'

test('state events fold into the snapshot', () => {
  const s = reduce(initialSnapshot, { type: 'state', payload: { groupStatus: 'member', roster: [{ name: 'mac' }] } })
  expect(s.groupStatus).toBe('member')
  expect(s.roster).toHaveLength(1)
})

test('error while joining also routes to joinError (resumed-join failure case)', () => {
  const joining = reduce(initialSnapshot, { type: 'state', payload: { groupStatus: 'joining' } })
  const s = reduce(joining, { type: 'error', payload: { message: 'boom' } })
  expect(s.lastError).toBe('boom')
  expect(s.joinError).toBe('boom')
})

test('error while not joining sets lastError only', () => {
  const s = reduce(initialSnapshot, { type: 'error', payload: { message: 'boom' } })
  expect(s.lastError).toBe('boom')
  expect(s.joinError).toBeNull()
})
```

`android/test/worklet-client.test.js` (mock `react-native-bare-kit` with a fake `Worklet` whose `IPC` is a tiny EventEmitter-with-write; mock `expo-file-system`/`expo-device`):

```js
jest.mock('react-native-bare-kit', () => {
  const { EventEmitter } = require('events')
  const instances = []
  class Worklet {
    constructor () {
      this.IPC = new EventEmitter()
      this.IPC.written = []
      this.IPC.write = (buf) => this.IPC.written.push(Buffer.from(buf).toString())
      instances.push(this)
    }
    start (path, source) { this.started = { path, source } }
  }
  return { Worklet, __instances: instances }
})
jest.mock('expo-device', () => ({ modelName: 'Pixel Test' }))
// mock expo-file-system and ../app/gen/worklet.bundle.mjs per the template's
// import mechanism (see worklet-client.js verify note)

import { getBridge } from '../lib/worklet-client'
const { __instances } = require('react-native-bare-kit')

test('first frame is init with storageDir + deviceName; singleton thereafter', () => {
  const bridge = getBridge()
  const w = __instances[0]
  const first = JSON.parse(w.IPC.written[0])
  expect(first.t).toBe('init')
  expect(first.deviceName).toBe('Pixel Test')
  expect(first.storageDir).toMatch(/pear-wallpaper/)
  expect(getBridge()).toBe(bridge)          // single-writer rule, enforcement point 1
  expect(__instances).toHaveLength(1)
})
```

`android/test/onboarding.test.js`: render `Onboarding` with a fake bridge prop; pressing "Create a group" calls `bridge.call('createGroup')`; typing an invite and pressing "Join" calls `bridge.call('joinGroup', invite)` (use `@testing-library/react-native` `fireEvent`).

- [ ] **Step 2: Run to verify failure.** `npm run test:ui` — modules don't exist yet.

- [ ] **Step 3: Implement.** `android/lib/store.js` — carry desktop `app.js`'s joining/joinError comment along with the logic:

```js
export const initialSnapshot = {
  groupStatus: 'none', roster: [], sends: [], received: [],
  lastError: null, joinError: null
}
export function reduce (snap, action) {
  switch (action.type) {
    case 'state': return { ...snap, ...action.payload }
    case 'error': {
      // Interactive join rejections come back through joinGroup's own
      // promise; the one join-shaped failure arriving here is a resumed
      // pending join failing on startup — groupStatus is still 'joining'
      // with no state push to clear it, so route it into joinError too
      // (same reasoning as desktop ui/app.js).
      const next = { ...snap, lastError: action.payload.message }
      return next.groupStatus === 'joining' ? { ...next, joinError: action.payload.message } : next
    }
    case 'dismiss-error': return { ...snap, lastError: null }
    default: return snap
  }
}
```

`android/lib/worklet-client.js` — module-level singleton; **verify against the template** how the bundle is imported (Metro asset vs `require` of the `.mjs` — copy the template's exact mechanism) and the current expo-file-system path API (SDK 54+ renamed `documentDirectory` → `Paths.document`; use what's installed):

```js
import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import * as Device from 'expo-device'
// bundle + storage path imports: copy the exact mechanism from the
// bare-expo template and the installed expo-file-system API.

let instance = null
export function getBridge () {
  if (instance) return instance.bridge
  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)
  const transport = createDuplexJsonTransport(worklet.IPC)
  const bridge = createBridgeUi(transport)
  // init MUST precede any bridge.call (host ignores bridge frames pre-init)
  transport.send({
    t: 'init',
    storageDir: `${documentsPath}/pear-wallpaper`,
    deviceName: Device.modelName || 'Android device'
  })
  instance = { worklet, bridge, transport }
  return bridge
}
export function getWorklet () { return instance ? instance.worklet : null }
```

`android/app/_layout.js`: create `SnapshotContext`; `useReducer(reduce, initialSnapshot)`; on mount `const bridge = getBridge()`, subscribe `bridge.on('state'|'error')` → dispatch, `bridge.call('getState').then(...)`; `AppState` listener — `active` → `getWorklet()?.resume()` then `bridge.call('syncNow')` (the powerMonitor-resume analog), `background` → `getWorklet()?.suspend(30000)` (linger; **verify the suspend/resume signatures** in the installed react-native-bare-kit and record divergences). `android/app/index.js`: route on `snapshot.groupStatus` — `'joining'` → `Waiting`, `'member'` → `MainView` (placeholder Text + roster count this task), else `Onboarding`. Components mirror the desktop versions' logic with RN primitives (`View`/`Text`/`TextInput`/`Pressable`); `ErrorBanner` renders `lastError` with a dismiss `Pressable` dispatching `dismiss-error`.

- [ ] **Step 4: Run to verify pass.** `npm run test:ui` green; `npm run test:worklet` still green.

- [ ] **Step 5: On-device milestone.** `npm run android` (bundles first — the dev-loop rule). Expect: Onboarding renders on the emulator. That render **is** the full-stack proof: RN → init frame → worklet boots the real core from the bundle → `getState` → snapshot → route (same argument as desktop QA Act 1). `adb logcat -s bare` for worklet-side output. Write `docs/notes/qa-android.md` Act 1 documenting exactly this.

- [ ] **Step 6: Commit.** JOURNAL line. Commit: `feat(android): RN shell — worklet client, snapshot store, onboarding routing`.

**Understanding checkpoint:** You can explain why Onboarding rendering on the emulator proves the entire pipeline; why `getBridge()` being a singleton is a *correctness* requirement (single-writer corestore), not a style choice; and what `suspend(linger)`/`resume()` do to the Bare thread across an AppState flip.

---

### Task 5: Pairing — QR scan + join flow (milestone: emulator joins a desktop-created group)

**Learning goal:** Blind-pairing end to end across heterogeneous shells — the desktop displays the invite QR built by `qrSvg`, the phone consumes it, and the "waiting for an existing device to come online" state is the UX face of pairing's requirement that an admitting member be online.

**Files:**
- Create: `android/components/ScanInvite.js`, `android/test/scan-invite.test.js`
- Modify: `android/components/Onboarding.js` (+ Scan button), `android/components/Waiting.js` (joinError display + retry guidance), `android/app.json` (expo-camera plugin + camera permission), `android/package.json` (`expo-camera` via `npx expo install`, pinned), `docs/notes/qa-android.md` (Act 2)

**Interfaces:**
- Consumes: `bridge.call('joinGroup', invite)` (existing bridge command; resolves/rejects per core contract), snapshot's `groupStatus`/`joinError`.
- Produces: `ScanInvite` component with props `{ onScanned(inviteString), onCancel() }`.

- [ ] **Step 1: Failing test** — `android/test/scan-invite.test.js`: mock `expo-camera` (`CameraView` as a `View` capturing props; `useCameraPermissions` returning granted). Render `ScanInvite`, invoke the captured `onBarcodeScanned({ data: 'pear://invite-string' })`, assert `onScanned` got `'pear://invite-string'` exactly once (scanners fire repeatedly — the component must latch). Second test: permission denied → renders a fallback message and a cancel control (paste remains the path).

- [ ] **Step 2: Verify failure, then implement.** `ScanInvite`: `useCameraPermissions` + request-on-mount; `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`; a `scannedRef` latch so only the first `onBarcodeScanned` fires `onScanned`. Onboarding: "Scan invite" button toggles `ScanInvite`; `onScanned` routes into the same join handler the paste input uses (local error state for interactive rejections, per the store comment). Waiting: show `joinError` when set, with "ask the creator for a fresh invite" copy (spec error-handling table).

- [ ] **Step 3: Tests pass; on-device QA (Act 2, write it into qa-android.md).** Desktop dev instance on the Mac (`npm run dev` in `desktop/`): create group, show invite QR (DeviceList). Emulator: two documented paths — (a) **paste path (reliable):** copy the invite string, `adb shell input text` or the emulator clipboard, join; (b) **camera path (full-fidelity):** screenshot the desktop QR, load it as the emulator's virtual-scene camera image (Extended controls → Camera → Add image), scan it in-app. Desktop shows the candidate → Approve → emulator transitions Waiting → Main placeholder; desktop roster shows the Android device. Also exercise: expired/garbage invite → error copy, deny → Waiting shows rejection.

- [ ] **Step 4: Commit.** JOURNAL line. Commit: `feat(android): pairing — QR scan + join flow; first cross-platform pair verified`.

**Understanding checkpoint:** You can narrate the pairing handshake hop-by-hop across the two shells (QR → blind-pairing candidate → creator approval → `add-device` op → roster sync) and explain why the emulator's Waiting screen can't complete without a desktop online.

---

### Task 6: Wallpaper setter module + apply controller (milestone: desktop→Android wallpaper visibly changes)

**Learning goal:** The apply inversion in the flesh — how desktop's worker-side `applyPending` loop becomes an RN-side controller over two bridge commands, with the identical coalescing and failure semantics; and what a local Expo Module is (Kotlin autolinked from `modules/`, no npm package).

**Files:**
- Create: `android/modules/wallpaper-setter/` (via `npx create-expo-module@latest --local wallpaper-setter`, then replace the generated example), `android/lib/apply-controller.js`, `android/test/apply-controller.test.js`
- Modify: `android/app/_layout.js` (wire controller), `android/app.json` (`android.permissions: ["android.permission.SET_WALLPAPER"]`), `docs/notes/qa-android.md` (Act 3)

**Interfaces:**
- Consumes: Task 1's `pendingWallpaper` → `{ id, filePath } | null` and `markApplied(id)` bridge commands.
- Produces: `setWallpaper(filePath, target)` (JS wrapper over the native module; `target ∈ 'home'|'lock'|'both'`; resolves `true` or rejects); `createApplyController({ bridge, setter, getTarget })` → `{ applyPending() }`. Consumed by Tasks 7 (reapply, lock toggle) and 9 (background round).

- [ ] **Step 1: Failing controller tests** — `android/test/apply-controller.test.js`:

```js
import { createApplyController } from '../lib/apply-controller'

function fakeBridge (queue) {
  const calls = []
  return {
    calls,
    call: jest.fn(async (cmd, ...args) => {
      calls.push([cmd, ...args])
      if (cmd === 'pendingWallpaper') return queue.shift() || null
      return true
    })
  }
}

test('applies every pending item: setter then markApplied, in order', async () => {
  const bridge = fakeBridge([{ id: 'a', filePath: '/f/a.jpg' }, { id: 'b', filePath: '/f/b.jpg' }])
  const setter = jest.fn(async () => true)
  await createApplyController({ bridge, setter, getTarget: () => 'home' }).applyPending()
  expect(setter.mock.calls).toEqual([['/f/a.jpg', 'home'], ['/f/b.jpg', 'home']])
  expect(bridge.calls.filter(c => c[0] === 'markApplied')).toEqual([['markApplied', 'a'], ['markApplied', 'b']])
})

test('setter failure leaves the item unacked (retried next trigger)', async () => {
  const bridge = fakeBridge([{ id: 'a', filePath: '/f/a.jpg' }])
  const setter = jest.fn(async () => { throw new Error('decode failed') })
  await createApplyController({ bridge, setter, getTarget: () => 'home' }).applyPending()
  expect(bridge.calls.some(c => c[0] === 'markApplied')).toBe(false)
})

test('concurrent triggers coalesce into one pass plus one queued rerun', async () => {
  let resolvePending
  const bridge = { call: jest.fn((cmd) => cmd === 'pendingWallpaper'
    ? new Promise((r) => { resolvePending = r })
    : Promise.resolve(true)) }
  const c = createApplyController({ bridge, setter: jest.fn(), getTarget: () => 'home' })
  const first = c.applyPending()
  c.applyPending(); c.applyPending()          // while first is in-flight
  resolvePending(null)
  await first
  await new Promise((r) => setImmediate(r))
  // one in-flight pass + exactly one queued rerun = 2 pendingWallpaper calls
  expect(bridge.call.mock.calls.filter(c => c[0] === 'pendingWallpaper')).toHaveLength(2)
})
```

- [ ] **Step 2: Verify failure, implement `android/lib/apply-controller.js`** — same coalescing shape as `sync-engine.applyPending` (that's the point: read them side by side):

```js
// The Android half of the apply inversion (spec §3.2): the worklet surfaces
// pending wallpapers over the bridge; this controller runs the native setter
// and acks. Mirrors sync-engine's applyPending semantics exactly — coalesced
// passes, and a setter/ack failure leaves the item unacked so the next
// trigger retries it.
export function createApplyController ({ bridge, setter, getTarget = () => 'home' }) {
  let applying = false
  let queued = false
  async function applyPending () {
    if (applying) { queued = true; return }
    applying = true
    try {
      while (true) {
        const item = await bridge.call('pendingWallpaper')
        if (!item) break
        await setter(item.filePath, getTarget())   // throws -> stays unacked
        await bridge.call('markApplied', item.id)
      }
    } catch {
      // swallowed by design: unacked item retries on the next trigger
    } finally {
      applying = false
      if (queued) { queued = false; applyPending() }
    }
  }
  return { applyPending }
}
```

- [ ] **Step 3: The native module.** Scaffold with `npx create-expo-module@latest --local wallpaper-setter`, delete the generated example bodies, keep the autolink plumbing (`expo-module.config.json` with `android` platform). Kotlin (`modules/wallpaper-setter/android/src/main/java/com/pearwallpaper/wallpapersetter/WallpaperSetterModule.kt`):

```kotlin
package com.pearwallpaper.wallpapersetter

import android.app.WallpaperManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

class WallpaperSetterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WallpaperSetter")
    // setStream, not setBitmap: the image streams straight to the wallpaper
    // service without materializing a full Bitmap in our heap.
    AsyncFunction("setWallpaper") { filePath: String, target: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
      val wm = WallpaperManager.getInstance(ctx)
      val flags = when (target) {
        "home" -> WallpaperManager.FLAG_SYSTEM
        "lock" -> WallpaperManager.FLAG_LOCK
        else -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
      }
      val file = File(filePath)
      if (!file.exists()) throw IllegalArgumentException("no such file: $filePath")
      FileInputStream(file).use { stream ->
        val id = wm.setStream(stream, null, true, flags)
        if (id == 0) throw IllegalStateException("WallpaperManager.setStream returned 0")
      }
      true
    }
  }
}
```

JS wrapper `modules/wallpaper-setter/index.js`:

```js
import { requireNativeModule } from 'expo-modules-core'
const native = requireNativeModule('WallpaperSetter')
export function setWallpaper (filePath, target = 'home') {
  return native.setWallpaper(filePath, target)
}
```

(Adjust generated paths/names to what `create-expo-module` actually emitted — its layout is ground truth; record divergences.)

- [ ] **Step 4: Wire it.** In `_layout.js`: create the controller once (`getTarget` reads the Task 7 settings module later; hardcode `'home'` until then); call `controller.applyPending()` after every `state` event dispatch and once after the initial `getState`. The bridge already pushes state on core's `wallpaper` event, so a new send arrives as a state push → controller runs → coalescing absorbs the burst.

- [ ] **Step 5: Tests pass, then the demo QA (Act 3, write it).** `npm run test:ui` green. Rebuild (`npm run android` — native module changed ⇒ full rebuild, not just Metro). Pair per Act 2, then from the desktop send an image targeting the Android device. Expect: within a sync beat the emulator's home wallpaper visibly changes; desktop's send status shows applied (the ack round-tripped). Check `adb logcat -s bare` for the sync trace.

- [ ] **Step 6: Commit.** JOURNAL line. Commit: `feat(android): WallpaperManager Expo module + apply controller; first cross-platform wallpaper apply`.

**Understanding checkpoint:** You can diagram the apply inversion (which side holds the pending loop on each platform and why); explain why a setter failure must NOT ack (and where the retry comes from); and say what `create-expo-module --local` wired up so Kotlin autolinks without an npm package.

---

### Task 7: Main UI — device list, invites, received history, settings

**Files:**
- Create: `android/lib/qr.js`, `android/lib/settings.js`, `android/components/{DeviceList,Received,Settings}.js`, `android/test/{devicelist,received,settings}.test.js`
- Modify: `android/components/MainView.js` (tabbed: Devices / Received / Settings), `android/package.json` (`@paulmillr/qr` pinned to desktop's version, `react-native-svg` via `npx expo install`, pinned), `docs/notes/qa-android.md` (Act 4)

**Learning goal:** Feature parity as a port, not a rewrite — every behavior here already exists in a desktop component; the exercise is separating each component's logic (identical) from its rendering (RN primitives), and noticing where the snapshot contract does the work (`loginAtLogin` absent ⇒ toggle not rendered).

**Interfaces:**
- Consumes: bridge commands `createInvite`, `approve`, `deny`, `removeDevice`; `candidate` event; Task 6's `setWallpaper` (direct reapply — the bridge `reapply` command doesn't exist without a worklet-side platform, by design).
- Produces: `qrSvg(text)` → SVG string (API-compatible with `desktop/ui/qr.js`); `getSettings()/setSettings(patch)` persisting `{ lockScreen: boolean }` to a JSON file in the app documents dir; `getTarget()` = `lockScreen ? 'both' : 'home'` consumed by Tasks 6/9's controller.

- [ ] **Step 1: Failing tests.** `devicelist.test.js`: with a fake bridge, "New invite" calls `createInvite` and renders the returned invite as both an `SvgXml` QR and selectable text; a `candidate` event renders an approval row whose Approve/Deny press calls `approve(key)`/`deny(key)`; a roster row's Remove calls `removeDevice`. `received.test.js`: renders items from `snapshot.received`; Reapply calls the setter directly with `item.filePath` and never calls `markApplied`. `settings.test.js`: lock-screen toggle round-trips through a mocked settings file; no login-at-login control rendered when the snapshot lacks the `loginAtLogin` key.

- [ ] **Step 2: Verify failure, implement.** `android/lib/qr.js` ports `desktop/ui/qr.js` (same `@paulmillr/qr` calls — read the desktop file and keep its API); render via `react-native-svg`'s `SvgXml`. `android/lib/settings.js`: read/write a `settings.json` under the documents dir (same expo-file-system API family as Task 4; default `{ lockScreen: false }`), export `getTarget()`. `Settings.js` also shows `deviceKey`/`deviceName` (read-only) and `lastSync`. Wire `getTarget` into the Task 6 controller. Port each desktop component's logic faithfully — where a behavior differs, that's a bug in the port, not a judgment call.

- [ ] **Step 3: Tests pass; QA (Act 4).** Full Main navigation on the emulator: create an invite **from Android** and redeem it on a second desktop instance (`--user-data-dir` per qa-desktop.md — Android approves the candidate); reapply an old wallpaper from Received; flip the lock toggle and confirm the next apply also sets the lock screen (emulator lock screen check).

- [ ] **Step 4: Commit.** JOURNAL line. Commit: `feat(android): main UI — device list, invites, received, settings`.

**Understanding checkpoint:** You can explain why Android's reapply calls the native setter directly while desktop routes `reapply` over the bridge (where the setter *lives* on each platform), and why the settings toggle needed no bridge/protocol change at all.

---

### Task 8: Share-sheet send (milestone: Android→desktop)

**Learning goal:** Android share intents as an app entry point — how an `ACTION_SEND` lands your app on a specific route with a `content://` URI, and why that URI must be materialized to a real file before the worklet can touch it (the `Send.js`/`webUtils` lesson, Android edition).

**Files:**
- Create: `android/app/send.js`, `android/lib/share-target.js`, `android/test/send-screen.test.js`
- Modify: `android/app.json` (expo-share-intent plugin), `android/package.json` (`expo-share-intent` pinned), `android/app/_layout.js` (share-intent hook → route to `/send`), `docs/notes/qa-android.md` (Act 5)

**Interfaces:**
- Consumes: `bridge.call('sendWallpaper', { filePath, targets })` (existing command; `targets` = array of device key hexes), snapshot's `roster`.
- Produces: `stageSharedImage(uri)` → local file path in the documents staging dir.

- [ ] **Step 1: Health-check the dependency (spec verify-point 2).** `npm view expo-share-intent time.modified versions dist-tags` + skim its GitHub issues for the installed Expo SDK. If it's maintained for SDK 55: `npx expo install`-compatible version, pin exact. If it's dead/broken: STOP, note it, and raise with Patrick — the fallback (hand-rolled intent-filter config plugin + native intent handling) is a scope change requiring sign-off. Record the verdict in `docs/notes/api-divergences.md`.

- [ ] **Step 2: Failing tests.** `send-screen.test.js`: given a staged file path and a roster of two devices via context, toggling one checkbox and pressing Send calls `bridge.call('sendWallpaper', { filePath, targets: [thatKeyOnly] })`; Send is disabled with zero targets selected. Test `stageSharedImage` with a mocked expo-file-system copy: returns a path under `staging/` preserving the extension.

- [ ] **Step 3: Verify failure, implement.** `lib/share-target.js`: `stageSharedImage(uri)` copies the `content://` URI into `<documents>/pear-wallpaper-staging/<timestamp>.<ext>` via expo-file-system (it accepts content URIs; the worklet's Bare fs cannot — say so in a comment) and returns the plain path. `app/send.js`: image preview + roster checkboxes + Send (mirrors desktop `Send.js` target selection), success → navigate back to Main with the send visible in `sends`. `_layout.js`: the share-intent hook (per expo-share-intent's README idiom for expo-router) routes incoming image shares to `/send` after staging. App must behave when opened via share **cold** (worklet not yet started — `getBridge()` handles it) and **warm**.

- [ ] **Step 4: Tests pass; QA (Act 5).** Rebuild (config plugin changed the manifest ⇒ full `npm run android`). On the emulator: open Photos/Files, share an image → "Pear Wallpaper" appears in the sheet → Send screen → pick the desktop device → desktop wallpaper changes (its worker auto-applies). Verify cold-start share too (kill app first).

- [ ] **Step 5: Commit.** JOURNAL line. Commit: `feat(android): share-sheet send target`.

**Understanding checkpoint:** You can trace a shared photo from the OS sheet to a desktop wallpaper: intent → staged file → `sendWallpaper` → hyperblobs write + `set-wallpaper` op → desktop sync → apply; and explain at which hop the sender's job is done (the op append — queued delivery owns the rest).

---

### Task 9: Background sync (spike, then build)

**Learning goal:** What Android actually promises a background app (WorkManager's ~15-min opportunistic window, nothing after force-stop) and how the bounded sync round — designed into core for exactly this — fits inside it. Plus the single-writer guard as a concrete instance of "one corestore, one opener."

**Files:**
- Create: `android/lib/background-sync.js`, `android/test/background-sync.test.js`
- Modify: `android/app/_layout.js` (task registration), `android/lib/worklet-client.js` (export `isActive()`), `android/package.json` (`expo-background-task` + `expo-task-manager` via `npx expo install`, pinned), `docs/notes/qa-android.md` (Act 6)

**Interfaces:**
- Consumes: Task 3's full worklet protocol (init/ready/shutdown), Task 6's `setWallpaper` + settings `getTarget`.
- Produces: `runBoundedSyncRound()` — the headless round; task name `'pear-wallpaper-sync'`.

- [ ] **Step 1: THE SPIKE (spec verify-point 3 — throwaway, do first).** Before any real code: register a minimal `expo-background-task` task whose body starts a `Worklet` with tiny **inline** source (`BareKit.IPC` echo), round-trips one frame, logs to logcat, terminates. Force-run it three ways and record which work: `BackgroundTask.triggerTaskWorkerForTestingAsync()` (dev API), `adb shell cmd jobscheduler run -f com.pearwallpaper.app <jobId>`, and a real 15-min wait. Test with the app foregrounded, backgrounded, and swipe-killed. **Write `docs/notes/headless-worklet-spike.md`** (≤10 lines + verdict). If the worklet cannot start headless: STOP — the documented fallback (spec §7: MVP ships sync-on-open only; foreground-service as follow-up) is Patrick's call. Delete the spike code either way.

- [ ] **Step 2: Failing tests** — `background-sync.test.js` (mock `react-native-bare-kit` as in Task 4's test, mock setter/settings): `runBoundedSyncRound()` sends `init`, then after `ready` calls `syncNow`, drains `pendingWallpaper`/setter/`markApplied`, sends `{t:'shutdown'}`, and calls `worklet.terminate()`. Guard test: when `worklet-client.isActive()` is true, the round returns `'skipped-active'` **without constructing a Worklet** (single-writer rule, enforcement point 2) — and instead nudges the existing bridge's `syncNow` + controller.

- [ ] **Step 3: Verify failure, implement `lib/background-sync.js`:**

```js
// Bounded background round = core/README.md's Android recipe, driven from
// the RN side over the bridge: init -> ready -> syncNow -> drain pending
// via the native setter -> shutdown -> terminate. Never runs concurrently
// with the resident worklet (single-writer corestore): if the app is alive
// with an active worklet, we nudge that one instead of opening a second.
import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import { createApplyController } from './apply-controller'
import { setWallpaper } from '../modules/wallpaper-setter'
import { getTarget } from './settings'
import { isActive, getBridge } from './worklet-client'

export async function runBoundedSyncRound () {
  if (isActive()) {
    const bridge = getBridge()
    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget }).applyPending()
    return 'nudged-resident'
  }
  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)            // same bundle import as worklet-client
  const transport = createDuplexJsonTransport(worklet.IPC)
  const bridge = createBridgeUi(transport)
  const ready = new Promise((resolve, reject) => {
    bridge.on('ready', resolve)
    bridge.on('error', (e) => reject(new Error(e.message)))
  })
  transport.send({ t: 'init', storageDir: STORAGE_DIR, deviceName: DEVICE_NAME })  // same values as worklet-client (extract shared consts)
  await ready
  try {
    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget }).applyPending()
  } finally {
    transport.send({ t: 'shutdown' })                  // graceful corestore close...
    await new Promise((r) => setTimeout(r, 2000))      // ...bounded, like desktop's quit
    worklet.terminate()
  }
  return 'synced'
}
```

Registration in `_layout.js` (module scope, per expo-task-manager rules): `TaskManager.defineTask('pear-wallpaper-sync', ...)` wrapping `runBoundedSyncRound` with errors → `logcat`; `BackgroundTask.registerTaskAsync('pear-wallpaper-sync', { minimumInterval: 15 })` on mount. Extract the storageDir/deviceName construction from `worklet-client.js` into shared consts so both entry points agree byte-for-byte (different storageDirs = two independent devices — a silent disaster).

- [ ] **Step 4: Tests pass; QA (Act 6, write it).** Pair + queue a send from desktop while the Android app is (a) backgrounded and (b) swipe-killed; force the job (methods proven by the spike); wallpaper changes in both cases (b may legitimately fail on some OEMs — record what the emulator does; the spec accepts opportunism). Also verify the guard: force the job with the app foregrounded — logcat shows `nudged-resident`, no second worklet.

- [ ] **Step 5: Commit.** JOURNAL line (including the spike verdict). Commit: `feat(android): opportunistic background sync via expo-background-task`.

**Understanding checkpoint:** You can explain why the bounded round exists in core's API at all (this task is its raison d'être); enumerate the two enforcement points of the single-writer rule and what breaks without them; and state precisely what Android does and doesn't guarantee about the 15-minute task.

---

### Task 10: QA hardening, docs, release-APK pass on a physical device

**Learning goal:** What "done" means for a shell in this project: the full manual script passes on real hardware from a release build, and the docs let future-you cold-start the whole dev loop.

**Files:**
- Create: `android/README.md`
- Modify: `docs/notes/qa-android.md` (Acts 7–9 + final e2e), `docs/notes/JOURNAL.md`, root `README.md` (if it enumerates shells)

**Interfaces:** none new — this task closes the loop.

- [ ] **Step 1: Finish qa-android.md.** Act 7 — lifecycle: AppState flips (foreground→background→foreground) with a send landing mid-suspend; tune the linger if syncs get truncated. Act 8 — revoke: desktop removes the Android device → Android is refused at handshake on next sync; verify the UI states it rather than spinning. Act 9 — release build: `npx expo run:android --variant release`, sideload the APK to the physical phone (`adb install`), full pairing+send+receive pass on real hardware over a real network (phone on LTE if possible — true NAT traversal).
- [ ] **Step 2: `android/README.md`:** architecture recap (three tiers, apply inversion), the dev loop (`npm run android`, the bundle trap in bold, logcat recipe), test split (brittle vs jest and why), scripts table, pinned-versions policy, pointer to qa-android.md and the spec.
- [ ] **Step 3: Run everything.** `cd bridge && npm test`; `cd desktop && npm test`; `cd android && npm run test:worklet && npm run test:ui`; then the full qa-android.md pass. Record final counts in JOURNAL.
- [ ] **Step 4: Final commit + the e2e gate.** Commit: `docs(android): QA script, README; release-APK pass on device`. The plan's exit criterion is the original spec §7 checklist across three devices: Mac + emulator + physical phone — send every direction, queue-while-offline scenario, background apply, revoke and confirm lockout.

**Understanding checkpoint:** You can hand someone `android/README.md` and qa-android.md and they can build, run, test, and QA the shell without asking you anything.
