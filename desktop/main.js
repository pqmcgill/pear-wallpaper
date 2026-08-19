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
// simulated. Config (storageDir/exePath) and graceful shutdown signaling
// land in Task 3; for now `args`/`opts` are omitted (`opts` is currently
// unused/reserved by bare-sidecar — see task-2-report.md).
const workerPipe = PearRuntime.run(path.join(__dirname, 'worker/core-host.js'))
workerPipe.on('error', (err) => console.error('[pear-wallpaper] worker pipe error', err))
workerPipe.on('exit', (code, status) => console.error('[pear-wallpaper] worker exited', code, status))

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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { try { workerPipe.destroy() } catch { /* already closed */ } })
