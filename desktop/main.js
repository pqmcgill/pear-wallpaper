'use strict'
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, powerMonitor } = require('electron')
const path = require('path')
const PearRuntime = require('pear-runtime')
const pkg = require('./package.json')

// Single instance: a second launch should focus the existing window instead
// of spawning a second worker/core alongside the first. Must be checked
// before app.whenReady() does anything (worker launch, window creation) so a
// losing second instance never gets that far.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  return
}
app.on('second-instance', () => { if (win) { win.show(); win.focus() } })

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
  // Close-to-tray: hitting the window's close button hides it instead of
  // quitting (the worker/core keep running in the background, reachable via
  // the tray). Only a real quit (tray "Quit" -> app.isQuitting = true, see
  // createTray below) lets the window actually close.
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide() }
  })
}

// Tray: menu-bar presence for the app while it's resident in the background
// (see close-to-tray above and app.dock.hide() below). "Sync now" talks
// directly to the worker over the same newline-JSON framing the relay
// below uses to speak bridge frames to/from the worker; -1 as the frame id
// is fine here since nothing in main.js correlates replies to requests (it
// only relays worker->renderer frames verbatim, see the workerPipe 'data'
// handler).
let tray = null
function createTray () {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'ui', 'trayTemplate.png')))
  const menu = Menu.buildFromTemplate([
    { label: 'Open Pear Wallpaper', click: () => { if (win) { win.show(); win.focus() } else createWindow() } },
    { label: 'Sync now', click: () => { if (workerPipe) workerPipe.write(Buffer.from(JSON.stringify({ t: 'req', id: -1, cmd: 'syncNow', args: [] }) + '\n')) } },
    { type: 'separator' },
    // Quit is handled entirely here: set the flag so close-to-tray/before-quit
    // let it through, then app.quit() triggers the before-quit handler below
    // (Task 3) which sends the worker a `{t:'shutdown'}` frame and waits for
    // it to tear down core/engine before the app process actually exits.
    // The renderer/tray must NOT call a bridge `quit` command — there isn't
    // one (final-review fix wave removed bridge-main's dead `quit` entry,
    // which called a nonexistent `Pear.exit(0)` left over from the
    // pre-Electron-conversion pear-runtime UI process shape).
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setToolTip('Pear Wallpaper')
  tray.setContextMenu(menu)
}

// Launch the Bare worker via pear-runtime@1.3.1. Electron's main process is
// a plain Node host (not itself running under Bare), so `pear-runtime`'s
// `#run` import condition resolves to lib/run/default.js, which does
// `new Sidecar(entrypoint, args, opts)` from `bare-sidecar` — a real OS
// subprocess running the platform's bundled `bare` binary
// (node_modules/bare-sidecar/prebuilds/<platform>/bare), wired to an fd-3
// IPC pipe. `PearRuntime.run()` returns that pipe as a Duplex stream
// (`workerPipe`); on the worker side, bare-sidecar's own bootstrap
// (node_modules/bare-sidecar/lib/runtime.js) puts the other end on the
// global `Bare.IPC` before loading worker/core-host.js. Confirmed via a
// standalone Node smoke harness (see task-2-report.md) — this is not
// simulated.
//
// Config: `opts` is reserved/unused by bare-sidecar (task-2-report.md), so
// storageDir/exePath travel as argv. `run(entry, [storageDir, exePath])`
// spawns `bare(entry, storageDir, exePath)`; the worker reads them back off
// `Bare.argv` (see worker/core-host.js). Both launch and window creation are
// deferred to `app.whenReady()` (moved out of module top-level from Task 2 —
// a lifecycle nit from that task's review: this way a failed
// `createWindow()` can't leave an orphaned worker process behind it).
let workerPipe = null

// OTA (Task 6): `pear.updater` is a SEPARATE capability of the same
// pear-runtime@1.3.1 package from the static `PearRuntime.run()` used
// above. Launching the worker needs no instance at all (Task 2); watching
// for updates needs a full `new PearRuntime(opts)` instance — its
// constructor eagerly creates a Corestore and (in `_open()`) joins a
// Hyperswarm DHT swarm to replicate the `opts.upgrade` link's Hyperdrive
// (node_modules/pear-runtime/index.js:13-42). That instance exposes
// `.updater`, a `pear-runtime-updater@3.4.0` instance
// (node_modules/pear-runtime-updater/index.js) which is the actual OTA
// state machine: it requires `dir`/`upgrade`/`name`/`store` (throws
// otherwise, index.js:18-21), emits `update-scheduled` -> `updating` ->
// `updating-delta`/`updating-progress` -> `updated`, and exposes
// `await updater.applyUpdate()` to atomically swap the installed bundle
// for the staged one (only once `updater.updated` is true and
// `opts.bundled` — i.e. only for a packaged app, index.js:94-113). See
// task-6-report.md for the full citation trail and the `opts.name`
// discrepancy between pear-runtime's and pear-runtime-updater's own docs.
let pear = null

// Per pear-runtime-updater/index.js:94-98's `applyUpdate()`, the staged
// build is looked up at `<staged>/by-arch/<platform>-<arch>/app/<name>` —
// `<name>` must be the packaged bundle's actual filename WITH extension
// (`.app` / `.exe` / `.msix` / `.AppImage`), not just productName (contrary
// to pear-runtime/README.md's simplified example comment "opts.name - The
// package.json productName of the app" — the updater's own code and its
// own README ("Application name with extension") are authoritative since
// `new PearRuntime(opts)` passes `opts` straight through to
// `new PearRuntimeUpdater(opts)`, index.js:25).
function updaterAppName () {
  if (process.platform === 'darwin') return `${pkg.productName}.app`
  if (process.platform === 'win32') return `${pkg.productName}.exe`
  return `${pkg.productName}.AppImage`
}

// Per pear-runtime/README.md's "Usage" example `getAppPath()`: path to the
// installed bundle, passed as `opts.app` so `applyUpdate()` knows what to
// swap. `null` (and thus `bundled: false` below) when unpackaged, so the
// updater never tries to watch/apply against a nonexistent bundle path
// during `npm run dev`.
function getAppBundlePath () {
  if (!app.isPackaged) return null
  if (process.platform === 'linux' && process.env.APPIMAGE) return process.env.APPIMAGE
  if (process.platform === 'win32') return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

// `restartToUpdate` is a main-process-only action (`app.relaunch`/`app.quit`)
// — the Bare worker has no relaunch capability, so this must never reach
// it. Routed through the *same* `bridge.call('restartToUpdate')` surface
// Settings.js already uses for other calls (see the `ipcMain.on(
// 'bridge:to-main', ...)` handler below, which intercepts this one cmd
// before it would otherwise be forwarded verbatim to workerPipe) rather
// than adding a second ipcRenderer channel/preload method — one relay to
// reason about, and Settings.js's existing `bridge.call(...)` pattern
// (see setLoginAtLogin) is reused unchanged.
async function restartToUpdate (evt, msg) {
  try {
    if (pear && pear.updater && pear.updater.updated) await pear.updater.applyUpdate()
    app.relaunch()
    app.quit()
  } catch (err) {
    console.error('[pear-wallpaper] restartToUpdate failed', err)
    if (evt && evt.sender) evt.sender.send('bridge:to-renderer', { t: 'res', id: msg.id, ok: false, error: err.message })
  }
}

app.whenReady().then(() => {
  // Menu-bar app: no dock icon, tray is the only chrome while backgrounded.
  if (app.dock) app.dock.hide()
  createTray()

  const storageDir = app.getPath('userData')
  const exePath = app.getPath('exe')

  workerPipe = PearRuntime.run(path.join(__dirname, 'worker/core-host.js'), [storageDir, exePath])
  workerPipe.on('error', (err) => console.error('[pear-wallpaper] worker pipe error', err))
  workerPipe.on('exit', (code, status) => console.error('[pear-wallpaper] worker exited', code, status))

  // main relays: it does NOT parse bridge frames, just forwards them.
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

  // OTA: construct the updater instance. Guarded — a network/updater
  // failure here (e.g. offline, sandboxed CI, no DHT reachable) must never
  // block worker launch or window creation, which have already happened
  // above by the time this could realistically fail.
  try {
    pear = new PearRuntime({
      dir: storageDir,
      version: pkg.version,
      upgrade: pkg.upgrade,
      name: updaterAppName(),
      app: getAppBundlePath(),
      bundled: app.isPackaged
    })
    pear.on('error', (err) => console.error('[pear-wallpaper] pear-runtime updater error', err))
    // BLOCKER fix (final-review): pear.updater is a SEPARATE EventEmitter from
    // `pear` (pear-runtime-updater@3.4.0, not forwarded onto `pear`) and emits
    // its own 'error' events. With zero listeners, Node's EventEmitter throws
    // on an unhandled 'error' emit, crashing the main process — and this app
    // joins the OTA DHT swarm every boot (see the `new PearRuntime(...)` above),
    // so updater errors are a real, not hypothetical, risk. Guarded for
    // `pear.updater` existing (it's created by the constructor above, but stay
    // defensive) and wired before any update activity below.
    if (pear.updater) pear.updater.on('error', (err) => console.error('[pear-wallpaper] updater error', err))
    pear.updater.on('updated', () => {
      console.log('[pear-wallpaper] update downloaded and ready, version', pear.updater.nextVersion)
      if (win) win.webContents.send('bridge:to-renderer', { t: 'evt', event: 'update-ready', payload: {} })
    })
  } catch (err) {
    console.error('[pear-wallpaper] pear-runtime updater init failed', err)
  }

  createWindow()

  // Wake-from-sleep: the OS can leave the sync engine's own timers stale
  // across a sleep/resume (schedules missed while suspended aren't replayed
  // on their own), so force a sync as soon as the machine wakes. Uses the
  // same newline-JSON framing as the tray's "Sync now" above; -2 as the
  // frame id is fine for the same reason (nothing in main.js correlates
  // replies to requests).
  powerMonitor.on('resume', () => {
    if (workerPipe) workerPipe.write(Buffer.from(JSON.stringify({ t: 'req', id: -2, cmd: 'syncNow', args: [] }) + '\n'))
  })
})
ipcMain.on('bridge:to-main', (evt, msg) => {
  if (msg && msg.cmd === 'restartToUpdate') { restartToUpdate(evt, msg); return }
  if (workerPipe) workerPipe.write(Buffer.from(JSON.stringify(msg) + '\n'))
})

// No window-all-closed→quit: this is a menu-bar-resident app (close-to-tray,
// see createWindow's win.on('close', ...) above), so hiding the last window
// must NOT quit it — only the tray's Quit item (or OS-level app.quit()) does.

// Graceful shutdown: send a `{ t: 'shutdown' }` control frame so the worker
// can run `engine.stop()`/`await core.close()` before it exits (see
// worker/core-host.js for why `.destroy()`/`.end()` alone can't carry this —
// `.destroy()` SIGTERMs the bare process with no JS-visible event in the
// worker, and `.end()` only half-closes and never reaches 'close', confirmed
// via a throwaway harness; see task-3-report.md). `before-quit` can't await
// async work, so hold the quit off with `event.preventDefault()` until
// either the worker's own `exit` event fires (it called `Bare.exit()` after
// tearing down) or a 2s grace period elapses, then force it with
// `.destroy()` and finish quitting via `app.exit()`.
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown || !workerPipe) return
  shuttingDown = true
  event.preventDefault()
  // Per pear-runtime/README.md: "be sure to await pear.close() during
  // process teardown". Fired off without blocking the existing worker
  // shutdown timeout below (which already bounds total quit time to 2s) —
  // it tears down the updater's swarm/store, but nothing downstream depends
  // on it finishing before the process exits.
  if (pear) pear.close().catch((err) => console.error('[pear-wallpaper] pear-runtime updater close failed', err))
  const finish = () => { try { workerPipe.destroy() } catch { /* already closed */ } app.exit() }
  const timer = setTimeout(finish, 2000)
  workerPipe.once('exit', () => { clearTimeout(timer); app.exit() })
  try {
    workerPipe.write(Buffer.from(JSON.stringify({ t: 'shutdown' }) + '\n'))
  } catch {
    clearTimeout(timer); finish()
  }
})
