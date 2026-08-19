'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const PearRuntime = require('pear-runtime')

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

app.whenReady().then(() => {
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

  createWindow()
})
ipcMain.on('bridge:to-main', (_evt, msg) => { if (workerPipe) workerPipe.write(Buffer.from(JSON.stringify(msg) + '\n')) })

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

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
  const finish = () => { try { workerPipe.destroy() } catch { /* already closed */ } app.exit() }
  const timer = setTimeout(finish, 2000)
  workerPipe.once('exit', () => { clearTimeout(timer); app.exit() })
  try {
    workerPipe.write(Buffer.from(JSON.stringify({ t: 'shutdown' }) + '\n'))
  } catch {
    clearTimeout(timer); finish()
  }
})
