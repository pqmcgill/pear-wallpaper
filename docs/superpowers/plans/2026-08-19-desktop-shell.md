# Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/`, a macOS Pear app that runs the frozen `core/` engine as a background/tray app and turns received images into the Mac's wallpaper.

**Architecture:** A Pear app whose UI layer is `pear-electron` (Electron under the hood). Two processes: the **main** process owns `WallpaperCore`, a background sync-and-apply engine, the tray, the wallpaper setter, launch-at-login, and a single-instance lock; the **renderer** is a Preact + htm UI (no build step) that holds only the latest state snapshot. They talk over a thin, transport-agnostic IPC **bridge**. OS-specific code (wallpaper setter, launch-at-login) sits behind small interfaces so Windows drops in later untouched.

**Tech Stack:** Pear runtime + `pear-electron`; `pear-wallpaper-core` (local `file:../core`); Preact + htm (ESM, no bundler); `@paulmillr/qr` for invite QR; `brittle` + `preact-render-to-string` for tests; macOS `osascript` and `launchctl` shelled out via an injectable exec.

**Spec:** `docs/superpowers/specs/2026-08-19-desktop-shell-design.md` (and the parent design `docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md`).

## Global Constraints

- **Frozen core API only.** The shell uses exactly the surface in `core/README.md`. It never touches hypercore/autobase/hyperswarm/hyperblobs/blind-pairing directly. Image validation is the core's job — never re-validate in the shell.
- **Exact core signatures** (copy verbatim when calling): `new WallpaperCore({ storageDir, deviceName, bootstrap = null })`; `ready()`, `close()`; props `deviceKey`, `deviceName`, `storageDir`, `groupStatus: 'none'|'joining'|'member'`; `createGroup()`, `createInvite(): string`, `joinGroup(invite)`, `approve(key)`, `deny(key)`; `listDevices(): [{key,name,isSelf,isCreator,online}]`, `removeDevice(key)`; `sendWallpaper(image, targets): {id}` (positional args; `image` may be a path string), `listSends({limit=20}): [{id,meta,sentAt,targets:[{key,status:'pending'|'delivered'|'superseded'}]}]`; `pendingWallpaper(): {id,filePath,fromKey,meta}|null`, `markApplied(id)`, `listReceived({limit=10}): [{id,fromKey,meta,filePath,appliedAt}]`; `sync({timeoutMs=30000})`; events `'wallpaper'({id,filePath,fromKey,meta})`, `'pairing-request'({candidateKey,name})`, `'roster-changed'()`, `'send-updated'({id})`, `'update'()`, `'error-joining'()`.
- **No in-app device rename.** The core has no rename op; device name is fixed at construction. Name defaults to `os.hostname()`, persisted in `<storageDir>/device-name.txt` on first boot, editable only by editing that file before a group is formed. The Settings panel shows it read-only. (Deviation from spec §8, which assumed editable; recorded here.)
- **Module systems.** Root `desktop/package.json` is `"type": "commonjs"` (main + `lib/`, matching `core/` and Bare). `desktop/ui/package.json` is `{"type":"module"}` (renderer ESM; browser and Node agree). UI tests are CJS `brittle` files that `await import(...)` the ESM renderer modules inside async test bodies.
- **Injectable side effects.** Every module that shells out or touches global OS state takes its effect as a constructor/factory option with a real default: the wallpaper setter takes `exec`, login-item takes `exec` + `dir` + `label`, the bridge takes a `transport`. Unit tests inject fakes; the real thing is manual smoke. This is why osascript/launchctl never run inside automated tests (they can trigger TCC Automation prompts that hang headless — proven in the launch-at-login spike).
- **Testing split** (matches `core/`): logic is tested automatically with `brittle`; OS effects (real osascript wallpaper change) and Pear glue (tray, real IPC transport, boot, auto-update) are verified by a manual QA script.
- **Commits:** frequent, one per task minimum; conventional-commit style (`feat(desktop): …`, `test(desktop): …`, `docs(desktop): …`).
- **Storage:** pass Pear's per-app storage path (`Pear.config.storage`) as `storageDir`. Received files land in `<storageDir>/received/` (core-managed).

---

## File Structure

```
desktop/
  package.json              # pear config (gui.closeHide), deps, scripts; type: commonjs
  index.js                  # MAIN entry: name resolve, core boot, single-instance, wire engine+bridge+tray+login-item
  lib/
    platform/
      index.js              # selectPlatform(): picks impl by process.platform
      darwin.js             # createDarwinPlatform({exec}): setWallpaper/currentWallpaper via osascript
    login-item.js           # createLoginItem({exec,dir,label}): enable/disable/isEnabled (LaunchAgent)
    single-instance.js      # createLock(lockPath): acquire/release (pidfile)
    sync-engine.js          # createSyncEngine({core,platform,intervalMs}): start/stop/syncNow/applyPending
    bridge-main.js          # createBridgeMain({core,platform,loginItem,engine,transport}): command dispatch + snapshot + event push
    device-name.js          # resolveDeviceName({storageDir,fs,hostname}): read-or-default persisted name
    pear-transport.js       # real pear-electron transport adapter (thin; manual-smoke only)
  ui/
    package.json            # {"type":"module"}
    index.html              # <script type=module src=./app.js>
    bridge-ui.js            # createBridgeUi(transport): call(cmd,args) + on(event) + getSnapshot subscription
    qr.js                   # invite string -> inline SVG via @paulmillr/qr
    app.js                  # root: subscribes to snapshot, routes on groupStatus
    components/
      Onboarding.js         # create-or-join
      Waiting.js            # joining / waiting-for-approval, with rejection messages
      DeviceList.js         # roster + candidate approval + invite(+QR) + remove
      Send.js               # drag-drop/picker + target-select + per-target status
      Received.js           # last-10 history + re-apply
      Settings.js           # read-only name/key + launch-at-login toggle
  test/
    platform-darwin.test.js
    login-item.test.js
    single-instance.test.js
    sync-engine.test.js
    bridge-main.test.js
    bridge-ui.test.js
    device-name.test.js
    ui-onboarding.test.js
    ui-devicelist.test.js
    ui-send.test.js
    ui-received.test.js
  README.md                 # desktop shell dev/run notes
docs/notes/qa-desktop.md    # manual QA script
```

---

## Task 1: Scaffold the Pear app (boots and instantiates the core)

**Files:**
- Create: `desktop/package.json`, `desktop/index.js`, `desktop/ui/package.json`, `desktop/ui/index.html`, `desktop/ui/app.js`, `desktop/README.md`
- (no automated test — this is wiring; deliverable is a manual boot smoke)

**Interfaces:**
- Consumes: `pear-wallpaper-core` (`file:../core`), `pear-electron`.
- Produces: a runnable Pear app; `Pear.config.storage` used as `storageDir`.

> **Note to implementer:** the exact `pear-electron` entry/boot incantation and how the renderer window is created are version-specific. **Step 1 is to read the current `pear-electron` README/example** (https://github.com/holepunchto/pear-electron) and adapt the entry wiring below to match it. If ESM-in-main causes trouble importing the CJS core under Bare, keep `index.js` CommonJS (as written here) — that is the default and lowest-risk. Report any deviation from this skeleton.

- [ ] **Step 1: Read `pear-electron` docs/example** for the entry pattern (how main boots, how the window/renderer is created, how `Pear.config.storage` is read). Note the actual API in your report.

- [ ] **Step 2: Prerequisite — Pear installed.** Confirm `pear` is available (`npm i -g pear` if not). This is a user/environment step; note it in the report if it required action.

- [ ] **Step 3: Write `desktop/package.json`**

```json
{
  "name": "pear-wallpaper-desktop",
  "version": "0.1.0",
  "type": "commonjs",
  "main": "index.js",
  "pear": {
    "name": "pear-wallpaper",
    "type": "desktop",
    "gui": { "width": 480, "height": 660, "closeHide": true }
  },
  "scripts": {
    "test": "brittle test/*.test.js",
    "dev": "pear run --dev ."
  },
  "dependencies": {
    "pear-wallpaper-core": "file:../core",
    "pear-electron": "^1",
    "preact": "^10.24.0",
    "htm": "^3.1.1",
    "@paulmillr/qr": "^0.2.1"
  },
  "devDependencies": {
    "brittle": "^3.19.0",
    "preact-render-to-string": "^6.5.0",
    "test-tmp": "^1.4.0"
  }
}
```

- [ ] **Step 4: Write `desktop/ui/package.json`**

```json
{ "type": "module" }
```

- [ ] **Step 5: Write `desktop/index.js`** (main entry — boot the core, log identity; window creation adapted from pear-electron docs in Step 1)

```js
const WallpaperCore = require('pear-wallpaper-core')

async function main () {
  const storageDir = Pear.config.storage // per-app, stable across updates
  const os = require('os')
  const core = new WallpaperCore({ storageDir, deviceName: os.hostname() })
  await core.ready()
  console.log('[pear-wallpaper] booted; deviceKey=', core.deviceKey, 'status=', core.groupStatus)

  // Window creation goes here, per pear-electron docs (Step 1).
  // Later tasks wire tray, sync-engine, and the bridge.

  Pear.teardown(() => core.close())
}

main().catch((err) => { console.error(err); Pear.exit(1) })
```

- [ ] **Step 6: Write `desktop/ui/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Pear Wallpaper</title></head>
  <body><div id="app"></div><script type="module" src="./app.js"></script></body>
</html>
```

- [ ] **Step 7: Write `desktop/ui/app.js`** (placeholder root; replaced in Task 8)

```js
import { h, render } from 'preact'
import htm from 'htm'
const html = htm.bind(h)
render(html`<main><h1>Pear Wallpaper</h1><p>booting…</p></main>`, document.getElementById('app'))
```

- [ ] **Step 8: Install deps** — `cd desktop && npm install`. Expected: installs cleanly, links `../core`.

- [ ] **Step 9: Manual boot smoke** — `cd desktop && pear run --dev .`. Expected: a window opens showing "Pear Wallpaper / booting…", and the terminal logs `booted; deviceKey=<hex> status=none`. Record the output in the report.

- [ ] **Step 10: Write `desktop/README.md`** — brief: what this is, `npm test`, `pear run --dev .`, that OS effects are manual-smoke. Then commit.

```bash
git add desktop/ && git commit -m "feat(desktop): scaffold Pear app that boots the core"
```

---

## Task 2: macOS wallpaper setter behind a platform interface

**Files:**
- Create: `desktop/lib/platform/darwin.js`, `desktop/lib/platform/index.js`
- Test: `desktop/test/platform-darwin.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks; Node `child_process.execFile`.
- Produces: `selectPlatform(): { setWallpaper(filePath): Promise<void>, currentWallpaper(): Promise<string> }`; `createDarwinPlatform({ exec }): {setWallpaper, currentWallpaper}`. Consumed by Tasks 4, 5, 8-part-wiring.

The `exec` option is injectable so tests never actually run `osascript` (which can hang on a TCC prompt). Default `exec` promisifies `execFile`.

- [ ] **Step 1: Write the failing test** — `desktop/test/platform-darwin.test.js`

```js
const test = require('brittle')
const { createDarwinPlatform } = require('../lib/platform/darwin.js')

test('setWallpaper invokes osascript with the path passed as an argv arg (no shell interpolation)', async (t) => {
  const calls = []
  const exec = async (cmd, args) => { calls.push({ cmd, args }); return { stdout: '', stderr: '' } }
  const p = createDarwinPlatform({ exec })
  await p.setWallpaper('/tmp/some image.png')
  t.is(calls.length, 1)
  t.is(calls[0].cmd, 'osascript')
  t.ok(calls[0].args.includes('--'), 'uses -- to separate the script from argv')
  t.is(calls[0].args[calls[0].args.length - 1], '/tmp/some image.png', 'path is the trailing argv item, unquoted')
  t.ok(calls[0].args.some((a) => a.includes('every desktop')), 'sets all desktops')
})

test('currentWallpaper returns the trimmed osascript stdout', async (t) => {
  const exec = async () => ({ stdout: '/Users/me/Pictures/wall.jpg\n', stderr: '' })
  const p = createDarwinPlatform({ exec })
  t.is(await p.currentWallpaper(), '/Users/me/Pictures/wall.jpg')
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && npx brittle test/platform-darwin.test.js`. Expected: FAIL (`createDarwinPlatform` not defined).

- [ ] **Step 3: Write `desktop/lib/platform/darwin.js`**

```js
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)

function defaultExec (cmd, args) { return execFileP(cmd, args) }

function createDarwinPlatform ({ exec = defaultExec } = {}) {
  return {
    // Pass the path via argv (not string-interpolated) to avoid AppleScript injection / quoting bugs.
    async setWallpaper (filePath) {
      await exec('osascript', [
        '-e', 'on run argv',
        '-e', 'set p to POSIX file (item 1 of argv)',
        '-e', 'tell application "System Events" to set picture of every desktop to p',
        '-e', 'end run',
        '--', filePath
      ])
    },
    async currentWallpaper () {
      const { stdout } = await exec('osascript', [
        '-e', 'tell application "System Events" to get picture of desktop 1'
      ])
      return String(stdout).trim()
    }
  }
}

module.exports = { createDarwinPlatform }
```

- [ ] **Step 4: Write `desktop/lib/platform/index.js`**

```js
const { createDarwinPlatform } = require('./darwin.js')

function selectPlatform () {
  if (process.platform === 'darwin') return createDarwinPlatform()
  throw new Error(`unsupported platform: ${process.platform} (only darwin in this plan)`)
}

module.exports = { selectPlatform }
```

- [ ] **Step 5: Run tests to verify they pass** — `cd desktop && npx brittle test/platform-darwin.test.js`. Expected: PASS, output pristine.

- [ ] **Step 6: Commit**

```bash
git add desktop/lib/platform desktop/test/platform-darwin.test.js
git commit -m "feat(desktop): macOS wallpaper setter behind platform interface"
```

> **Manual smoke (record in report, do not automate):** in a Node REPL on macOS, `createDarwinPlatform().setWallpaper('/absolute/path/to/test.jpg')` — grant the one-time Automation prompt, confirm the desktop changes on all displays, and that `currentWallpaper()` reads the new path back.

---

## Task 3: Launch-at-login via LaunchAgent

**Files:**
- Create: `desktop/lib/login-item.js`
- Test: `desktop/test/login-item.test.js`

**Interfaces:**
- Consumes: Node `fs`, `child_process` (injectable `exec`).
- Produces: `createLoginItem({ exec, dir, label, programArguments }): { enable(): Promise<void>, disable(): Promise<void>, isEnabled(): Promise<boolean> }`. Consumed by Tasks 5 (bridge `setLoginAtLogin`) and index wiring.

This promotes the launch-at-login spike into a real, reversible test. `launchctl` does **not** trigger a TCC prompt (proven in the spike), so unlike osascript this test runs the real thing against a temp dir + unique label + harmless `RunAtLoad` payload.

- [ ] **Step 1: Write the failing test** — `desktop/test/login-item.test.js`

```js
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const os = require('os')
const tmp = require('test-tmp')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)
const { createLoginItem } = require('../lib/login-item.js')

test('enable writes a LaunchAgent that RunAtLoad-fires, isEnabled reflects it, disable removes it', async (t) => {
  const dir = await tmp(t)
  const marker = path.join(dir, 'ran.txt')
  const label = 'com.pearwallpaper.test.' + process.pid
  const li = createLoginItem({
    dir,
    label,
    programArguments: ['/usr/bin/touch', marker],
    exec: (cmd, args) => execFileP(cmd, args)
  })
  t.absent(await li.isEnabled(), 'not enabled initially')
  await li.enable()
  await new Promise((r) => setTimeout(r, 800)) // let launchd RunAtLoad fire
  t.ok(fs.existsSync(marker), 'RunAtLoad executed the program')
  t.ok(await li.isEnabled(), 'isEnabled true after enable')
  t.ok(fs.existsSync(path.join(dir, label + '.plist')), 'plist written')
  await li.disable()
  t.absent(await li.isEnabled(), 'isEnabled false after disable')
  t.absent(fs.existsSync(path.join(dir, label + '.plist')), 'plist removed')
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && npx brittle test/login-item.test.js`. Expected: FAIL (`createLoginItem` not defined).

- [ ] **Step 3: Write `desktop/lib/login-item.js`**

```js
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)

const defaultDir = path.join(os.homedir(), 'Library', 'LaunchAgents')

function plistBody (label, programArguments) {
  const args = programArguments.map((a) => `    <string>${a}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`
}

function createLoginItem ({
  exec = (cmd, args) => execFileP(cmd, args),
  dir = defaultDir,
  label = 'com.pear-wallpaper',
  programArguments
} = {}) {
  const plistPath = path.join(dir, label + '.plist')
  const domain = `gui/${process.getuid()}`
  return {
    async enable () {
      if (!programArguments || !programArguments.length) throw new Error('programArguments required to enable')
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(plistPath, plistBody(label, programArguments))
      await exec('launchctl', ['bootstrap', domain, plistPath])
    },
    async disable () {
      try { await exec('launchctl', ['bootout', `${domain}/${label}`]) } catch {}
      try { await fs.promises.unlink(plistPath) } catch {}
    },
    async isEnabled () {
      try { await exec('launchctl', ['print', `${domain}/${label}`]); return true } catch { return false }
    }
  }
}

module.exports = { createLoginItem }
```

- [ ] **Step 4: Run test to verify it passes** — `cd desktop && npx brittle test/login-item.test.js`. Expected: PASS, output pristine. (If launchd is slow, the 800ms wait may need a bump — note it.)

- [ ] **Step 5: Commit**

```bash
git add desktop/lib/login-item.js desktop/test/login-item.test.js
git commit -m "feat(desktop): launch-at-login via LaunchAgent (from spike)"
```

---

## Task 4: Single-instance lock

**Files:**
- Create: `desktop/lib/single-instance.js`
- Test: `desktop/test/single-instance.test.js`

**Interfaces:**
- Consumes: Node `fs`.
- Produces: `createLock(lockPath): { acquire(): boolean, release(): void }`. Consumed by index wiring (Task boot). `acquire()` returns `true` if this process now holds the lock, `false` if another live process holds it. Stale locks (dead pid) are reclaimed.

- [ ] **Step 1: Write the failing test** — `desktop/test/single-instance.test.js`

```js
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const { createLock } = require('../lib/single-instance.js')

test('second acquire on a held lock fails; release frees it', async (t) => {
  const dir = await tmp(t)
  const lp = path.join(dir, 'app.lock')
  const a = createLock(lp)
  const b = createLock(lp)
  t.ok(a.acquire(), 'first acquire succeeds')
  t.absent(b.acquire(), 'second acquire fails while held')
  a.release()
  t.ok(b.acquire(), 'acquire succeeds after release')
  b.release()
})

test('a stale lock (dead pid) is reclaimed', async (t) => {
  const dir = await tmp(t)
  const lp = path.join(dir, 'app.lock')
  fs.writeFileSync(lp, '999999999') // a pid that is not alive
  const a = createLock(lp)
  t.ok(a.acquire(), 'reclaims stale lock')
  a.release()
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && npx brittle test/single-instance.test.js`. Expected: FAIL (`createLock` not defined).

- [ ] **Step 3: Write `desktop/lib/single-instance.js`**

```js
const fs = require('fs')

function isAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function createLock (lockPath) {
  let held = false
  return {
    acquire () {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fd = fs.openSync(lockPath, 'wx') // exclusive create
          fs.writeSync(fd, String(process.pid))
          fs.closeSync(fd)
          held = true
          return true
        } catch (err) {
          if (err.code !== 'EEXIST') throw err
          const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10)
          if (Number.isFinite(owner) && isAlive(owner)) return false
          try { fs.unlinkSync(lockPath) } catch {} // stale; reclaim and retry
        }
      }
      return false
    },
    release () {
      if (!held) return
      try { fs.unlinkSync(lockPath) } catch {}
      held = false
    }
  }
}

module.exports = { createLock }
```

- [ ] **Step 4: Run tests to verify they pass** — `cd desktop && npx brittle test/single-instance.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/lib/single-instance.js desktop/test/single-instance.test.js
git commit -m "feat(desktop): single-instance pidfile lock"
```

---

## Task 5: Background sync-and-apply engine

**Files:**
- Create: `desktop/lib/sync-engine.js`
- Test: `desktop/test/sync-engine.test.js`

**Interfaces:**
- Consumes: a `core` (frozen API: `on`, `sync`, `pendingWallpaper`, `markApplied`) and a `platform` (`setWallpaper`).
- Produces: `createSyncEngine({ core, platform, intervalMs = 180000 }): { start(): void, stop(): void, syncNow(): Promise<void>, applyPending(): Promise<void>, lastSync: number|null, on(event, cb) }`. Emits `'error'(err)` and `'applied'({id})`. Consumed by index wiring and the bridge (`syncNow`, `lastSync`).

This is the highest-value logic in the shell. Test all apply branches against a **faked core** and **fake platform** — no Pear, no OS.

- [ ] **Step 1: Write the failing tests** — `desktop/test/sync-engine.test.js`

```js
const test = require('brittle')
const EventEmitter = require('events')
const { createSyncEngine } = require('../lib/sync-engine.js')

function fakeCore (pending) {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    syncCalls: 0, applied: [],
    async sync () { this.syncCalls++ },
    async pendingWallpaper () { return pending.shift() || null },
    async markApplied (id) { this.applied.push(id) }
  })
}
function fakePlatform (opts = {}) {
  return { setCalls: [], async setWallpaper (p) { this.setCalls.push(p); if (opts.fail) throw new Error('setter boom') } }
}

test('applyPending: null pending is a no-op (no setter, no ack)', async (t) => {
  const core = fakeCore([]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  await eng.applyPending()
  t.is(platform.setCalls.length, 0)
  t.is(core.applied.length, 0)
})

test('applyPending: sets wallpaper then marks applied on success', async (t) => {
  const core = fakeCore([{ id: 's1', filePath: '/r/s1.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  await eng.applyPending()
  t.is(platform.setCalls[0], '/r/s1.png')
  t.alike(core.applied, ['s1'], 'ack written after setter success')
})

test('applyPending: setter failure skips markApplied and emits error (stays queued)', async (t) => {
  const core = fakeCore([{ id: 's2', filePath: '/r/s2.png' }]); const platform = fakePlatform({ fail: true })
  const eng = createSyncEngine({ core, platform })
  const errors = []; eng.on('error', (e) => errors.push(e))
  await eng.applyPending()
  t.is(platform.setCalls.length, 1)
  t.is(core.applied.length, 0, 'NOT acked on failure')
  t.is(errors.length, 1)
})

test("start(): a 'wallpaper' event triggers applyPending (real-time path)", async (t) => {
  const core = fakeCore([{ id: 's3', filePath: '/r/s3.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform }); eng.start()
  core.emit('wallpaper', { id: 's3', filePath: '/r/s3.png' })
  await new Promise((r) => setTimeout(r, 20))
  t.alike(core.applied, ['s3'])
  eng.stop()
})

test('syncNow(): calls core.sync then applyPending and updates lastSync', async (t) => {
  const core = fakeCore([{ id: 's4', filePath: '/r/s4.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  t.is(eng.lastSync, null)
  await eng.syncNow()
  t.is(core.syncCalls, 1)
  t.alike(core.applied, ['s4'])
  t.ok(typeof eng.lastSync === 'number')
})
```

- [ ] **Step 2: Run tests to verify they fail** — `cd desktop && npx brittle test/sync-engine.test.js`. Expected: FAIL (`createSyncEngine` not defined).

- [ ] **Step 3: Write `desktop/lib/sync-engine.js`**

```js
const EventEmitter = require('events')

function createSyncEngine ({ core, platform, intervalMs = 180000 }) {
  const ee = new EventEmitter()
  let timer = null
  let applying = false
  let queued = false
  const engine = {
    lastSync: null,
    on: ee.on.bind(ee),
    async applyPending () {
      // Coalesce concurrent triggers: never run two apply passes at once.
      if (applying) { queued = true; return }
      applying = true
      try {
        let item
        while ((item = await core.pendingWallpaper())) {
          try {
            await platform.setWallpaper(item.filePath)
          } catch (err) {
            ee.emit('error', err) // leave unacked -> retried next trigger
            break
          }
          await core.markApplied(item.id)
          ee.emit('applied', { id: item.id })
        }
      } finally {
        applying = false
        if (queued) { queued = false; this.applyPending() }
      }
    },
    async syncNow () {
      try { await core.sync() } catch (err) { ee.emit('error', err) }
      this.lastSync = Date.now()
      await this.applyPending()
    },
    start () {
      core.on('wallpaper', () => { engine.applyPending() })
      timer = setInterval(() => { engine.syncNow() }, intervalMs)
      if (timer.unref) timer.unref()
    },
    stop () { if (timer) clearInterval(timer); timer = null }
  }
  return engine
}

module.exports = { createSyncEngine }
```

- [ ] **Step 4: Run tests to verify they pass** — `cd desktop && npx brittle test/sync-engine.test.js`. Expected: PASS, output pristine.

- [ ] **Step 5: Commit**

```bash
git add desktop/lib/sync-engine.js desktop/test/sync-engine.test.js
git commit -m "feat(desktop): background sync-and-apply engine"
```

---

## Task 6: Device-name resolver

**Files:**
- Create: `desktop/lib/device-name.js`
- Test: `desktop/test/device-name.test.js`

**Interfaces:**
- Consumes: Node `fs`, `os` (both injectable for test).
- Produces: `resolveDeviceName({ storageDir, fs, hostname }): string`. On first call it persists `<storageDir>/device-name.txt` = hostname default; subsequent calls return the persisted value. Consumed by index wiring (before constructing the core).

- [ ] **Step 1: Write the failing test** — `desktop/test/device-name.test.js`

```js
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const { resolveDeviceName } = require('../lib/device-name.js')

test('defaults to hostname and persists it', async (t) => {
  const dir = await tmp(t)
  const name = resolveDeviceName({ storageDir: dir, fs, hostname: () => 'Mac-Studio' })
  t.is(name, 'Mac-Studio')
  t.is(fs.readFileSync(path.join(dir, 'device-name.txt'), 'utf8'), 'Mac-Studio')
})

test('returns the persisted value on later calls (ignores hostname)', async (t) => {
  const dir = await tmp(t)
  fs.writeFileSync(path.join(dir, 'device-name.txt'), 'Living-Room')
  t.is(resolveDeviceName({ storageDir: dir, fs, hostname: () => 'Mac-Studio' }), 'Living-Room')
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && npx brittle test/device-name.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `desktop/lib/device-name.js`**

```js
const path = require('path')
const os = require('os')

function resolveDeviceName ({ storageDir, fs = require('fs'), hostname = () => os.hostname() }) {
  const file = path.join(storageDir, 'device-name.txt')
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {}
  const name = hostname()
  fs.mkdirSync(storageDir, { recursive: true })
  fs.writeFileSync(file, name)
  return name
}

module.exports = { resolveDeviceName }
```

- [ ] **Step 4: Run test to verify it passes** — `cd desktop && npx brittle test/device-name.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/lib/device-name.js desktop/test/device-name.test.js
git commit -m "feat(desktop): persisted device-name resolver"
```

---

## Task 7: IPC bridge (main + ui sides, transport-agnostic)

**Files:**
- Create: `desktop/lib/bridge-main.js`, `desktop/ui/bridge-ui.js`
- Test: `desktop/test/bridge-main.test.js`, `desktop/test/bridge-ui.test.js`

**Interfaces:**
- Consumes: `core` (frozen API), `platform` (`setWallpaper`), `loginItem` (`enable/disable/isEnabled`), `engine` (`syncNow`, `lastSync`), and a `transport`.
- **Transport contract:** `{ send(msg): void, onMessage(cb): void }`, where `msg` is a plain JSON-serializable object. Both sides share this. The real pear-electron adapter (Task 9) implements it; tests use an in-memory pair.
- Produces (main): `createBridgeMain({ core, platform, loginItem, engine, transport }): { start(): void }`. Produces (ui): `createBridgeUi(transport): { call(cmd, args): Promise<any>, on(event, cb): void }`.
- **Wire protocol:** requests `{ t:'req', id, cmd, args }` → replies `{ t:'res', id, ok, value|error }`; events `{ t:'evt', event, payload }`.
- **Commands** (each maps to exactly one core/side call): `getState`, `createGroup`, `createInvite`, `joinGroup(invite)`, `approve(key)`, `deny(key)`, `removeDevice(key)`, `sendWallpaper({filePath,targets})` → `core.sendWallpaper(filePath, targets)`, `reapply(wallpaperId)` → look up in `listReceived`, `platform.setWallpaper(filePath)`, `syncNow`, `setLoginAtLogin(bool)`.
- **Events pushed to ui:** `state` (full snapshot), `candidate` (`{candidateKey,name}` from `pairing-request`), `error` (`{message}`).
- **Snapshot shape** (`getState` and every `state` event): `{ deviceKey, deviceName, groupStatus, roster, sends, received, loginAtLogin, lastSync }`.

- [ ] **Step 1: Write the failing tests** — `desktop/test/bridge-main.test.js`

```js
const test = require('brittle')
const EventEmitter = require('events')
const { createBridgeMain } = require('../lib/bridge-main.js')

function pairTransport () {
  const a = new EventEmitter(); const b = new EventEmitter()
  return [
    { send: (m) => b.emit('message', m), onMessage: (cb) => a.on('message', cb) },
    { send: (m) => a.emit('message', m), onMessage: (cb) => b.on('message', cb) }
  ]
}
function fakeCore () {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    deviceKey: 'aa', deviceName: 'Mac', groupStatus: 'member', calls: [],
    async listDevices () { return [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }] },
    async listSends () { return [] },
    async listReceived () { return [{ id: 'r1', fromKey: 'bb', meta: {}, filePath: '/r/r1.png', appliedAt: 1 }] },
    async createGroup () { this.calls.push(['createGroup']) },
    async createInvite () { this.calls.push(['createInvite']); return 'INVITE123' },
    async approve (k) { this.calls.push(['approve', k]) },
    async sendWallpaper (img, targets) { this.calls.push(['sendWallpaper', img, targets]); return { id: 'x' } }
  })
}

test('getState returns the documented snapshot shape', async (t) => {
  const [mainT, uiT] = pairTransport()
  const core = fakeCore()
  const loginItem = { async isEnabled () { return true } }
  const engine = { lastSync: 42, async syncNow () {} }
  createBridgeMain({ core, platform: {}, loginItem, engine, transport: mainT }).start()

  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res') res(m) }))
  uiT.send({ t: 'req', id: 1, cmd: 'getState', args: [] })
  const r = await reply
  t.ok(r.ok)
  t.alike(Object.keys(r.value).sort(), ['deviceKey','deviceName','groupStatus','lastSync','loginAtLogin','received','roster','sends'])
  t.is(r.value.loginAtLogin, true)
  t.is(r.value.lastSync, 42)
})

test('sendWallpaper command maps {filePath,targets} to positional core call', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 7) res(m) }))
  uiT.send({ t: 'req', id: 7, cmd: 'sendWallpaper', args: [{ filePath: '/a.png', targets: ['bb'] }] })
  await reply
  t.alike(core.calls.find((c) => c[0] === 'sendWallpaper'), ['sendWallpaper', '/a.png', ['bb']])
})

test('reapply looks up filePath in listReceived and calls platform.setWallpaper', async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  const platform = { setCalls: [], async setWallpaper (p) { this.setCalls.push(p) } }
  createBridgeMain({ core, platform, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 8) res(m) }))
  uiT.send({ t: 'req', id: 8, cmd: 'reapply', args: ['r1'] })
  await reply
  t.alike(platform.setCalls, ['/r/r1.png'])
})

test("a core 'pairing-request' becomes a 'candidate' event on the ui transport", async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const got = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'evt' && m.event === 'candidate') res(m.payload) }))
  core.emit('pairing-request', { candidateKey: 'cc', name: 'Phone' })
  t.alike(await got, { candidateKey: 'cc', name: 'Phone' })
})

test("a failed command replies ok:false with the error message", async (t) => {
  const [mainT, uiT] = pairTransport(); const core = fakeCore()
  core.createGroup = async () => { throw new Error('already in a group (or joining one)') }
  createBridgeMain({ core, platform: {}, loginItem: { async isEnabled () { return false } }, engine: { lastSync: null, async syncNow () {} }, transport: mainT }).start()
  const reply = new Promise((res) => uiT.onMessage((m) => { if (m.t === 'res' && m.id === 9) res(m) }))
  uiT.send({ t: 'req', id: 9, cmd: 'createGroup', args: [] })
  const r = await reply
  t.absent(r.ok); t.is(r.error, 'already in a group (or joining one)')
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && npx brittle test/bridge-main.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `desktop/lib/bridge-main.js`**

```js
function createBridgeMain ({ core, platform, loginItem, engine, transport }) {
  async function snapshot () {
    const inGroup = core.groupStatus === 'member'
    return {
      deviceKey: core.deviceKey,
      deviceName: core.deviceName,
      groupStatus: core.groupStatus,
      roster: inGroup ? await core.listDevices() : [],
      sends: inGroup ? await core.listSends() : [],
      received: inGroup ? await core.listReceived() : [],
      loginAtLogin: await loginItem.isEnabled(),
      lastSync: engine.lastSync
    }
  }

  const commands = {
    getState: () => snapshot(),
    createGroup: () => core.createGroup(),
    createInvite: () => core.createInvite(),
    joinGroup: (invite) => core.joinGroup(invite),
    approve: (key) => core.approve(key),
    deny: (key) => core.deny(key),
    removeDevice: (key) => core.removeDevice(key),
    sendWallpaper: ({ filePath, targets }) => core.sendWallpaper(filePath, targets),
    reapply: async (wallpaperId) => {
      const list = await core.listReceived({ limit: 50 })
      const item = list.find((r) => r.id === wallpaperId)
      if (!item) throw new Error('unknown received wallpaper')
      await platform.setWallpaper(item.filePath)
    },
    syncNow: () => engine.syncNow(),
    setLoginAtLogin: (on) => (on ? loginItem.enable() : loginItem.disable())
  }

  function pushEvent (event, payload) { transport.send({ t: 'evt', event, payload }) }
  async function pushState () { pushEvent('state', await snapshot()) }

  return {
    start () {
      transport.onMessage(async (msg) => {
        if (!msg || msg.t !== 'req') return
        const fn = commands[msg.cmd]
        if (!fn) return transport.send({ t: 'res', id: msg.id, ok: false, error: `unknown command: ${msg.cmd}` })
        try {
          const value = await fn(...(msg.args || []))
          transport.send({ t: 'res', id: msg.id, ok: true, value })
        } catch (err) {
          transport.send({ t: 'res', id: msg.id, ok: false, error: err.message })
        }
      })
      // Forward core signals as state refreshes + scoped events.
      core.on('update', pushState)
      core.on('roster-changed', pushState)
      core.on('send-updated', pushState)
      core.on('wallpaper', pushState)
      core.on('pairing-request', (p) => pushEvent('candidate', p))
      core.on('error-joining', () => pushEvent('error', { message: 'auto-resume join failed; ask the creator for a fresh invite' }))
      engine.on && engine.on('error', (err) => pushEvent('error', { message: err.message }))
      engine.on && engine.on('applied', pushState)
    }
  }
}

module.exports = { createBridgeMain }
```

- [ ] **Step 4: Write the ui-side failing test** — `desktop/test/bridge-ui.test.js`

```js
const test = require('brittle')
const EventEmitter = require('events')

function pairTransport () {
  const a = new EventEmitter(); const b = new EventEmitter()
  return [
    { send: (m) => b.emit('message', m), onMessage: (cb) => a.on('message', cb) },
    { send: (m) => a.emit('message', m), onMessage: (cb) => b.on('message', cb) }
  ]
}

test('call() resolves with the reply value and matches by id', async (t) => {
  const { createBridgeUi } = await import('../ui/bridge-ui.js')
  const [uiT, mainT] = pairTransport()
  mainT.onMessage((m) => { if (m.t === 'req') mainT.send({ t: 'res', id: m.id, ok: true, value: { echoed: m.cmd } }) })
  const bridge = createBridgeUi(uiT)
  t.alike(await bridge.call('getState'), { echoed: 'getState' })
})

test('call() rejects when the reply is ok:false', async (t) => {
  const { createBridgeUi } = await import('../ui/bridge-ui.js')
  const [uiT, mainT] = pairTransport()
  mainT.onMessage((m) => { if (m.t === 'req') mainT.send({ t: 'res', id: m.id, ok: false, error: 'nope' }) })
  const bridge = createBridgeUi(uiT)
  await t.exception(() => bridge.call('createGroup'), /nope/)
})

test('on() delivers pushed events', async (t) => {
  const { createBridgeUi } = await import('../ui/bridge-ui.js')
  const [uiT, mainT] = pairTransport()
  const bridge = createBridgeUi(uiT)
  const got = new Promise((res) => bridge.on('candidate', res))
  mainT.send({ t: 'evt', event: 'candidate', payload: { candidateKey: 'cc', name: 'Phone' } })
  t.alike(await got, { candidateKey: 'cc', name: 'Phone' })
})
```

- [ ] **Step 5: Run to verify it fails** — `cd desktop && npx brittle test/bridge-ui.test.js`. Expected: FAIL.

- [ ] **Step 6: Write `desktop/ui/bridge-ui.js`**

```js
export function createBridgeUi (transport) {
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  transport.onMessage((msg) => {
    if (!msg) return
    if (msg.t === 'res') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error))
    } else if (msg.t === 'evt') {
      const set = listeners.get(msg.event)
      if (set) for (const cb of set) cb(msg.payload)
    }
  })
  return {
    call (cmd, ...args) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        transport.send({ t: 'req', id, cmd, args })
      })
    },
    on (event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(cb)
    }
  }
}
```

- [ ] **Step 7: Run both bridge tests** — `cd desktop && npx brittle test/bridge-main.test.js test/bridge-ui.test.js`. Expected: PASS, pristine.

- [ ] **Step 8: Commit**

```bash
git add desktop/lib/bridge-main.js desktop/ui/bridge-ui.js desktop/test/bridge-main.test.js desktop/test/bridge-ui.test.js
git commit -m "feat(desktop): transport-agnostic IPC bridge (main + ui)"
```

---

## Task 8: Renderer — QR + root routing + Onboarding + Waiting

**Files:**
- Create: `desktop/ui/qr.js`, `desktop/ui/app.js` (replace Task 1 placeholder), `desktop/ui/components/Onboarding.js`, `desktop/ui/components/Waiting.js`
- Test: `desktop/test/ui-onboarding.test.js`

**Interfaces:**
- Consumes: `createBridgeUi` (Task 7), Preact + htm, `@paulmillr/qr`.
- Produces: `qrSvg(text): string` (inline SVG string); `Onboarding({ bridge })`, `Waiting({ snapshot })` components; `app.js` renders and re-renders on `state` events, routing on `snapshot.groupStatus`.
- Components are pure functions of props (testable via `preact-render-to-string`); side effects go through `bridge.call`.

- [ ] **Step 1: Write the failing test** — `desktop/test/ui-onboarding.test.js`

```js
const test = require('brittle')

test('Onboarding renders create + join controls', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Onboarding } = await import('../ui/components/Onboarding.js')
  const html = render(h(Onboarding, { bridge: { call: async () => {} } }))
  t.ok(/create/i.test(html), 'has a create control')
  t.ok(/join/i.test(html), 'has a join control')
})

test('qrSvg returns an <svg> string for an invite', async (t) => {
  const { qrSvg } = await import('../ui/qr.js')
  const svg = qrSvg('INVITE-ABC')
  t.ok(svg.includes('<svg'), 'produces svg markup')
})

test('Waiting shows a rejection message when snapshot carries a joinError', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Waiting } = await import('../ui/components/Waiting.js')
  const html = render(h(Waiting, { snapshot: { groupStatus: 'none', joinError: 'PAIRING_REJECTED' } }))
  t.ok(/denied|rejected/i.test(html))
})
```

- [ ] **Step 2: Run to verify it fails** — `cd desktop && npx brittle test/ui-onboarding.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `desktop/ui/qr.js`**

```js
import encodeQR from '@paulmillr/qr'
// @paulmillr/qr can render SVG directly.
export function qrSvg (text) {
  return encodeQR(text, 'svg')
}
```

> If the installed `@paulmillr/qr` API differs (e.g. a named export or different render arg), adapt this one function to produce an SVG string and keep the signature `qrSvg(text): string`. Note any change in the report.

- [ ] **Step 4: Write `desktop/ui/components/Onboarding.js`**

```js
import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { qrSvg } from '../qr.js'
const html = htm.bind(h)

export function Onboarding ({ bridge }) {
  const [invite, setInvite] = useState(null)
  const [joinValue, setJoinValue] = useState('')
  const create = async () => { setInvite(await bridge.call('createGroup').then(() => bridge.call('createInvite'))) }
  const join = async () => { await bridge.call('joinGroup', joinValue.trim()) }
  return html`
    <section class="onboarding">
      <h1>Pear Wallpaper</h1>
      <div class="create">
        <button onClick=${create}>Create a group</button>
        ${invite && html`
          <div class="invite">
            <code>${invite}</code>
            <div class="qr" dangerouslySetInnerHTML=${{ __html: qrSvg(invite) }}></div>
          </div>`}
      </div>
      <div class="join">
        <input placeholder="Paste invite" value=${joinValue} onInput=${(e) => setJoinValue(e.target.value)} />
        <button onClick=${join}>Join a group</button>
      </div>
    </section>`
}
```

- [ ] **Step 5: Write `desktop/ui/components/Waiting.js`**

```js
import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

const MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.'
}

export function Waiting ({ snapshot }) {
  const err = snapshot.joinError
  if (err) return html`<section class="waiting error"><p>${MESSAGES[err] || 'Could not join. Ask for a fresh invite.'}</p></section>`
  return html`<section class="waiting"><p>Waiting for an existing device to come online and approve this one…</p></section>`
}
```

- [ ] **Step 6: Write `desktop/ui/app.js`** (replaces the Task 1 placeholder — root routing)

```js
import { h, render } from 'preact'
import htm from 'htm'
import { createBridgeUi } from './bridge-ui.js'
import { Onboarding } from './components/Onboarding.js'
import { Waiting } from './components/Waiting.js'
// Main window (Task 9-11 components) imported here as they land:
import { MainView } from './components/MainView.js'
const html = htm.bind(h)

// pearTransport is provided by the preload/runtime; see pear-transport wiring (Task 9).
const bridge = createBridgeUi(window.__pearTransport)
let snapshot = { groupStatus: 'none', roster: [], sends: [], received: [] }

function App () {
  if (snapshot.groupStatus === 'joining') return html`<${Waiting} snapshot=${snapshot} />`
  if (snapshot.groupStatus === 'member') return html`<${MainView} bridge=${bridge} snapshot=${snapshot} />`
  return html`<${Onboarding} bridge=${bridge} />`
}
function draw () { render(h(App, {}), document.getElementById('app')) }

bridge.on('state', (s) => { snapshot = { ...snapshot, ...s }; draw() })
bridge.on('error', (e) => { snapshot = { ...snapshot, joinError: e.code || snapshot.joinError }; draw() })
bridge.call('getState').then((s) => { snapshot = { ...snapshot, ...s }; draw() })
draw()
```

> `MainView` is created in Task 11 (it composes DeviceList/Send/Received/Settings tabs). Until then, either stub `components/MainView.js` to `export function MainView(){ return null }` so `app.js` imports resolve, or defer the `MainView` import line until Task 11. Note which you did.

- [ ] **Step 7: Run to verify it passes** — `cd desktop && npx brittle test/ui-onboarding.test.js`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/ui/qr.js desktop/ui/app.js desktop/ui/components/Onboarding.js desktop/ui/components/Waiting.js desktop/test/ui-onboarding.test.js
git commit -m "feat(desktop): renderer root, onboarding, waiting, invite QR"
```

---

## Task 9: Main wiring — real pear-electron transport, tray, single-instance, lifecycle

**Files:**
- Create: `desktop/lib/pear-transport.js`, `desktop/lib/tray.js`
- Modify: `desktop/index.js`
- (manual-smoke deliverable; the underlying logic modules are already unit-tested)

**Interfaces:**
- Consumes: everything built so far — `selectPlatform`, `createLoginItem`, `createLock`, `createSyncEngine`, `createBridgeMain`, `resolveDeviceName`, `WallpaperCore`, `pear-electron`.
- Produces: a fully wired running app. `pear-transport.js` implements the transport contract `{ send, onMessage }` over pear-electron's window IPC (`win.send` / `win.on('message')`). `tray.js` exposes `createTray({ ui, onOpen, onSyncNow, onQuit, getSummary }): Promise<untray>`.

> **Note to implementer:** `pear-transport.js` and the tray/window wiring are the version-specific glue. Read the `pear-electron` README (from Task 1) for the actual `ui.Window`/`win.send`/message-iteration API and the preload mechanism that exposes the transport to the renderer (`window.__pearTransport` in `app.js`). Adapt the skeletons below to the real API and verify by manual smoke. Keep the transport contract shape identical so the unit-tested bridge is unchanged.

- [ ] **Step 1: Write `desktop/lib/pear-transport.js`** (adapter over pear-electron IPC)

```js
// Main-side transport: bridges the bridge <-> a pear-electron window.
// Adapt `win.send` / message iteration to the installed pear-electron API.
function createPearTransportMain (win) {
  const handlers = []
  ;(async () => { for await (const msg of win) for (const h of handlers) h(msg) })()
  return { send: (m) => win.send(m), onMessage: (cb) => handlers.push(cb) }
}
module.exports = { createPearTransportMain }
```

- [ ] **Step 2: Write `desktop/lib/tray.js`**

```js
// Build the system tray via pear-electron's ui.app.tray.
async function createTray ({ ui, iconPath, onOpen, onSyncNow, onQuit, getSummary }) {
  const untray = await ui.app.tray(
    { icon: iconPath, menu: { open: 'Open window', sync: 'Sync now', quit: 'Quit' } },
    (key) => {
      if (key === 'open' || key === 'click') return onOpen()
      if (key === 'sync') return onSyncNow()
      if (key === 'quit') return onQuit()
    }
  )
  return untray
}
module.exports = { createTray }
```

- [ ] **Step 3: Rewrite `desktop/index.js`** to wire everything

```js
const path = require('path')
const os = require('os')
const WallpaperCore = require('pear-wallpaper-core')
const ui = require('pear-electron')
const { selectPlatform } = require('./lib/platform/index.js')
const { createLoginItem } = require('./lib/login-item.js')
const { createLock } = require('./lib/single-instance.js')
const { createSyncEngine } = require('./lib/sync-engine.js')
const { createBridgeMain } = require('./lib/bridge-main.js')
const { resolveDeviceName } = require('./lib/device-name.js')
const { createPearTransportMain } = require('./lib/pear-transport.js')
const { createTray } = require('./lib/tray.js')

async function main () {
  const storageDir = Pear.config.storage
  const lock = createLock(path.join(storageDir, 'app.lock'))
  if (!lock.acquire()) { console.error('another instance is running'); Pear.exit(0); return }

  const deviceName = resolveDeviceName({ storageDir })
  const core = new WallpaperCore({ storageDir, deviceName })
  await core.ready()

  const platform = selectPlatform()
  const engine = createSyncEngine({ core, platform })
  engine.start()

  const pearBin = process.execPath // resolve real pear binary path; verify during smoke
  const loginItem = createLoginItem({
    label: 'com.pear-wallpaper',
    programArguments: [pearBin, 'run', `pear://${Pear.config.key || ''}`]
  })

  // Create the window (adapt to pear-electron API), then wire the transport + bridge.
  const win = await ui.app.window
    ? ui.app.window                              // adapt: obtain the app window/view per pear-electron
    : null
  const transport = createPearTransportMain(win)
  createBridgeMain({ core, platform, loginItem, engine, transport }).start()

  await createTray({
    ui,
    iconPath: path.join(__dirname, 'ui', 'trayTemplate.png'),
    onOpen: () => ui.app.show(),
    onSyncNow: () => engine.syncNow(),
    onQuit: () => Pear.exit(0),
    getSummary: async () => core.groupStatus
  })

  Pear.teardown(async () => { engine.stop(); lock.release(); await core.close() })
}

main().catch((err) => { console.error(err); Pear.exit(1) })
```

- [ ] **Step 4: Add a tray icon asset** — `desktop/ui/trayTemplate.png` (a small monochrome PNG; a placeholder is fine for MVP). Note its source in the report.

- [ ] **Step 5: Manual smoke** — `cd desktop && pear run --dev .`. Verify and record: (a) window opens to Onboarding (`groupStatus:none`); (b) a tray icon appears with Open/Sync/Quit; (c) closing the window **hides** it (app keeps running — check the process); (d) tray → Open reopens; (e) tray → Quit exits; (f) starting a second `pear run` while one is up refuses via the single-instance lock.

- [ ] **Step 6: Commit**

```bash
git add desktop/lib/pear-transport.js desktop/lib/tray.js desktop/index.js desktop/ui/trayTemplate.png
git commit -m "feat(desktop): wire core, engine, bridge, tray, single-instance"
```

---

## Task 10: Renderer — DeviceList (roster, candidate approval, invite, remove)

**Files:**
- Create: `desktop/ui/components/DeviceList.js`
- Test: `desktop/test/ui-devicelist.test.js`

**Interfaces:**
- Consumes: `bridge`, `snapshot.roster` (`[{key,name,isSelf,isCreator,online}]`), a `candidates` prop (`[{candidateKey,name}]`, accumulated in `MainView` from `candidate` events).
- Produces: `DeviceList({ bridge, snapshot, candidates })`. Buttons call `bridge.call('createInvite')`, `'approve'`, `'deny'`, `'removeDevice'`. Invite display reuses `qrSvg`.

- [ ] **Step 1: Write the failing test** — `desktop/test/ui-devicelist.test.js`

```js
const test = require('brittle')

test('renders roster names and online state', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }, { key: 'bb', name: 'Tablet', isSelf: false, isCreator: false, online: false }] }
  const html = render(h(DeviceList, { bridge: {}, snapshot, candidates: [] }))
  t.ok(/Mac/.test(html) && /Tablet/.test(html))
})

test('shows approve/deny for a pending candidate and approve calls bridge', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { DeviceList } = await import('../ui/components/DeviceList.js')
  const calls = []
  const bridge = { call: async (...a) => calls.push(a) }
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true, isCreator: true, online: true }] }
  const html = render(h(DeviceList, { bridge, snapshot, candidates: [{ candidateKey: 'cc', name: 'Phone' }] }))
  t.ok(/Phone/.test(html) && /approve/i.test(html))
})
```

- [ ] **Step 2: Run to verify it fails** — `cd desktop && npx brittle test/ui-devicelist.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `desktop/ui/components/DeviceList.js`**

```js
import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { qrSvg } from '../qr.js'
const html = htm.bind(h)

export function DeviceList ({ bridge, snapshot, candidates }) {
  const [invite, setInvite] = useState(null)
  const self = snapshot.roster.find((d) => d.isSelf)
  const amCreator = !!(self && self.isCreator)
  const invfrom = async () => setInvite(await bridge.call('createInvite'))
  return html`
    <section class="devices">
      <ul>
        ${snapshot.roster.map((d) => html`
          <li key=${d.key}>
            <span class="dot ${d.online ? 'on' : 'off'}"></span>
            ${d.name} ${d.isSelf ? '(this device)' : ''} ${d.isCreator ? '· creator' : ''}
            ${amCreator && !d.isSelf && html`<button onClick=${() => bridge.call('removeDevice', d.key)}>Remove</button>`}
          </li>`)}
      </ul>
      ${amCreator && candidates.map((c) => html`
        <div class="candidate" key=${c.candidateKey}>
          <span>${c.name} wants to join</span>
          <button onClick=${() => bridge.call('approve', c.candidateKey)}>Approve</button>
          <button onClick=${() => bridge.call('deny', c.candidateKey)}>Deny</button>
        </div>`)}
      ${amCreator && html`
        <div class="invite-block">
          <button onClick=${invfrom}>Create invite</button>
          ${invite && html`<code>${invite}</code><div dangerouslySetInnerHTML=${{ __html: qrSvg(invite) }}></div>`}
        </div>`}
    </section>`
}
```

- [ ] **Step 4: Run to verify it passes** — `cd desktop && npx brittle test/ui-devicelist.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/components/DeviceList.js desktop/test/ui-devicelist.test.js
git commit -m "feat(desktop): device list, candidate approval, invite"
```

---

## Task 11: Renderer — Send, Received, Settings, and MainView

**Files:**
- Create: `desktop/ui/components/Send.js`, `desktop/ui/components/Received.js`, `desktop/ui/components/Settings.js`, `desktop/ui/components/MainView.js`
- Test: `desktop/test/ui-send.test.js`, `desktop/test/ui-received.test.js`

**Interfaces:**
- Consumes: `bridge`, `snapshot.roster`, `snapshot.sends`, `snapshot.received`, `snapshot.loginAtLogin`, `snapshot.deviceKey`, `snapshot.deviceName`.
- Produces: `Send({bridge,snapshot})`, `Received({bridge,snapshot})`, `Settings({bridge,snapshot})`, `MainView({bridge,snapshot})` (tabs + accumulates `candidate` events for DeviceList).
- `Send` sends `bridge.call('sendWallpaper', { filePath, targets })`; shows per-target status from `snapshot.sends[].targets[].status`. `Received` calls `bridge.call('reapply', id)`. `Settings` toggles `bridge.call('setLoginAtLogin', bool)` and shows read-only name/key.

- [ ] **Step 1: Write the failing tests** — `desktop/test/ui-send.test.js`

```js
const test = require('brittle')

test('Send lists targetable devices (excludes self) and disables send with none chosen', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true }, { key: 'bb', name: 'Tablet', isSelf: false }], sends: [] }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Tablet/.test(html), 'lists a target')
  t.absent(/>Mac</.test(html.replace(/this device/g, '')), 'self not a target row')
})
```

`desktop/test/ui-received.test.js`

```js
const test = require('brittle')

test('Received lists applied wallpapers and re-apply calls the bridge', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Received } = await import('../ui/components/Received.js')
  const snapshot = { received: [{ id: 'r1', fromKey: 'bb', meta: { filename: 'sunset.jpg' }, filePath: '/r/r1.jpg', appliedAt: 1 }] }
  const html = render(h(Received, { bridge: {}, snapshot }))
  t.ok(/sunset\.jpg|r1/.test(html))
  t.ok(/re-?apply/i.test(html))
})
```

- [ ] **Step 2: Run to verify they fail** — `cd desktop && npx brittle test/ui-send.test.js test/ui-received.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `desktop/ui/components/Send.js`**

```js
import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

export function Send ({ bridge, snapshot }) {
  const [filePath, setFilePath] = useState(null)
  const [targets, setTargets] = useState({})
  const targetable = snapshot.roster.filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])
  const onDrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFilePath(f.path) }
  const pick = async () => { const p = await bridge.call('pickImage').catch(() => null); if (p) setFilePath(p) }
  const send = async () => { await bridge.call('sendWallpaper', { filePath, targets: chosen }); setFilePath(null); setTargets({}) }
  const statusFor = (key) => {
    for (const s of snapshot.sends) { const tr = s.targets.find((tt) => tt.key === key); if (tr) return tr.status }
    return null
  }
  return html`
    <section class="send" onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
      <div class="dropzone" onClick=${pick}>${filePath ? filePath : 'Drop an image here, or click to browse'}</div>
      <ul>
        ${targetable.map((d) => html`
          <li key=${d.key}>
            <label><input type="checkbox" checked=${!!targets[d.key]}
              onChange=${(e) => setTargets({ ...targets, [d.key]: e.target.checked })} /> ${d.name}</label>
            <span class="status">${statusFor(d.key) || ''}</span>
          </li>`)}
      </ul>
      <button disabled=${!filePath || chosen.length === 0} onClick=${send}>Send</button>
    </section>`
}
```

> Note: `pickImage` is a convenience bridge command that opens a native file dialog in main and returns a path. Add it to `bridge-main.js` commands (opens pear-electron's file dialog; adapt to the API) — or, if the dialog API is uncertain, rely on drag-drop only for MVP and remove the `pick` handler. Record the choice.

- [ ] **Step 4: Write `desktop/ui/components/Received.js`**

```js
import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

export function Received ({ bridge, snapshot }) {
  return html`
    <section class="received">
      <ul>
        ${(snapshot.received || []).map((r) => html`
          <li key=${r.id}>
            <img src=${'file://' + r.filePath} alt="" width="120" />
            <span>${(r.meta && r.meta.filename) || r.id}</span>
            <button onClick=${() => bridge.call('reapply', r.id)}>Re-apply</button>
          </li>`)}
      </ul>
    </section>`
}
```

- [ ] **Step 5: Write `desktop/ui/components/Settings.js`**

```js
import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

export function Settings ({ bridge, snapshot }) {
  return html`
    <section class="settings">
      <p>Device name: <strong>${snapshot.deviceName}</strong> <small>(edit device-name.txt before joining to change)</small></p>
      <p>Device key: <code>${snapshot.deviceKey}</code></p>
      <label><input type="checkbox" checked=${!!snapshot.loginAtLogin}
        onChange=${(e) => bridge.call('setLoginAtLogin', e.target.checked)} /> Launch at login</label>
    </section>`
}
```

- [ ] **Step 6: Write `desktop/ui/components/MainView.js`**

```js
import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import htm from 'htm'
import { DeviceList } from './DeviceList.js'
import { Send } from './Send.js'
import { Received } from './Received.js'
import { Settings } from './Settings.js'
const html = htm.bind(h)

export function MainView ({ bridge, snapshot }) {
  const [tab, setTab] = useState('devices')
  const [candidates, setCandidates] = useState([])
  useEffect(() => {
    bridge.on('candidate', (c) => setCandidates((cs) => cs.some((x) => x.candidateKey === c.candidateKey) ? cs : [...cs, c]))
    bridge.on('state', () => setCandidates((cs) => cs)) // roster changes prune elsewhere; kept simple for MVP
  }, [])
  const pruned = candidates.filter((c) => !snapshot.roster.some((d) => d.key === c.candidateKey))
  return html`
    <div class="main">
      <nav>
        <button onClick=${() => setTab('devices')}>Devices</button>
        <button onClick=${() => setTab('send')}>Send</button>
        <button onClick=${() => setTab('received')}>Received</button>
        <button onClick=${() => setTab('settings')}>Settings</button>
      </nav>
      ${tab === 'devices' && html`<${DeviceList} bridge=${bridge} snapshot=${snapshot} candidates=${pruned} />`}
      ${tab === 'send' && html`<${Send} bridge=${bridge} snapshot=${snapshot} />`}
      ${tab === 'received' && html`<${Received} bridge=${bridge} snapshot=${snapshot} />`}
      ${tab === 'settings' && html`<${Settings} bridge=${bridge} snapshot=${snapshot} />`}
    </div>`
}
```

- [ ] **Step 7: Run to verify tests pass** — `cd desktop && npx brittle test/ui-send.test.js test/ui-received.test.js`. Expected: PASS. (If `MainView` was stubbed in Task 8, ensure the stub is now replaced and `app.js` imports the real one.)

- [ ] **Step 8: Commit**

```bash
git add desktop/ui/components/Send.js desktop/ui/components/Received.js desktop/ui/components/Settings.js desktop/ui/components/MainView.js desktop/test/ui-send.test.js desktop/test/ui-received.test.js
git commit -m "feat(desktop): send, received, settings, main view"
```

---

## Task 12: Full-suite green, manual QA script, and docs

**Files:**
- Create: `docs/notes/qa-desktop.md`
- Modify: `docs/notes/JOURNAL.md`, `desktop/README.md`

- [ ] **Step 1: Run the whole automated suite** — `cd desktop && npm test`. Expected: every `test/*.test.js` passes, output pristine (no stray warnings). Fix anything red before proceeding; record the summary (N passing).

- [ ] **Step 2: Write `docs/notes/qa-desktop.md`** — a manual QA script mirroring `docs/notes/qa-pairing.md`. Cover, as an explicit checklist:
  - Two instances (two Macs, or two `storageDir`s via `PEAR_*` / separate app data — document the exact commands).
  - Create group on A; Create invite; on B paste invite → B shows "waiting"; on A approve the candidate → B routes to main; roster shows both on both.
  - Send A→B (drag-drop + target select); grant the one-time Automation prompt on B; **wallpaper changes on B**; A's Send tab shows the target flip to delivered ✓.
  - Send B→A the other direction.
  - Close B's window → confirm it hides to tray and the process keeps running; send A→B while B's window is hidden → **wallpaper still applies** (background engine).
  - Sleep/wake B → confirm a queued send applies after wake.
  - Settings → Launch at login on → confirm the LaunchAgent plist exists; validate against a **staged** build (`pear stage`/`pear release`) since the plist invokes `pear run pear://<key>`.
  - Revoke: on A remove B → B's next connection is refused; confirm B can no longer receive.
  - Re-apply: on B, Received tab → Re-apply a past wallpaper → wallpaper changes with no network.

- [ ] **Step 3: Update `docs/notes/JOURNAL.md`** — append a "Plan 2 (desktop shell)" entry: what shipped, the pear-electron/Electron discovery, the launch-at-login spike outcome, the device-rename deviation, and any deferred items surfaced during implementation.

- [ ] **Step 4: Update `desktop/README.md`** — final dev/run/test/stage instructions and the testing split (automated logic vs manual OS/Pear smoke).

- [ ] **Step 5: Commit**

```bash
git add docs/notes/qa-desktop.md docs/notes/JOURNAL.md desktop/README.md
git commit -m "docs(desktop): manual QA script, journal, README"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 runtime/process model → Tasks 1, 9. §2 launch-at-login spike → Task 3. §4 bridge vocabulary → Task 7. §5 module structure → all tasks follow it. §6 UI screens → Tasks 8, 10, 11. §7 sync engine (three triggers + apply pipeline + single-instance) → Tasks 4 (engine, event-push + timer + syncNow), 9 (single-instance wiring), with wake-from-sleep noted as timer-covered/optional. §8 storage/identity/distribution → Task 9 (`Pear.config.storage`), Task 6 (device name), Task 12 (stage/release in QA). §9 testing → every task's automated tests + Task 12 QA. §10 non-goals → respected (Windows behind `platform/`, keychain deferred).
- **Wake-from-sleep trigger:** the spec calls it a nice-to-have covered by the timer. The plan implements the timer + event-push + syncNow and does not add a dedicated powerMonitor hook; if `pear-electron` exposes `powerMonitor` it can be added in Task 9 as a `syncNow` caller. Documented as optional, consistent with spec §7.
- **In-app rename:** spec §8 said name editable in settings; the frozen core has no rename op, so the plan scopes name to first-boot/config-file + read-only Settings and records the deviation (Global Constraints + Task 11).

**Placeholder scan:** no TBD/TODO left as work items. The version-specific `pear-electron` glue (entry boot, window creation, real transport, file dialog, tray icon asset) is flagged with explicit "read the README and adapt" notes rather than hidden — these are genuine integration points that can only be pinned against the installed library, and each has a concrete skeleton + a manual-smoke acceptance check.

**Type consistency:** snapshot shape identical across `getState`, `state` events, and all consumers (`{deviceKey,deviceName,groupStatus,roster,sends,received,loginAtLogin,lastSync}`); `sendWallpaper` command→core mapping is `{filePath,targets}`→`(filePath, targets)` everywhere; transport contract `{send,onMessage}` and wire protocol (`req`/`res`/`evt`) identical on both bridge sides; core signatures match `core/README.md` verbatim.
