'use strict'
/* global Bare */
// Bare worker entry, spawned by pear-runtime's `PearRuntime.run()` (which,
// from a Node/Electron host, is bare-sidecar's `Sidecar` — a real OS
// subprocess running the bundled `bare` binary). bare-sidecar's own
// bootstrap (node_modules/bare-sidecar/lib/runtime.js) opens fd 3 as a
// `bare-pipe` Pipe and assigns it to the global `Bare.IPC` *before* loading
// this module, so `Bare.IPC` is this worker's side of the same duplex the
// host process gets back from `PearRuntime.run()`. See
// node_modules/bare-sidecar/README.md:28-32 and
// node_modules/bare-sidecar/lib/runtime.js:6-32 (per Task 2).
//
// Bare has no Node builtins (`fs`/`path`/`os`/`child_process`/`util` all
// fail to resolve — confirmed empirically, see task-3-report.md) and no
// global `process`. desktop/package.json's "imports" field remaps
// fs/path/os/util/child_process to their bare-* equivalents (mirroring the
// same trick already used by ../../core/package.json for fs/path) for any
// module specifier require, and lib/compat/process.js polyfills the
// `process` global that lib/platform/index.js and lib/login-item.js read
// directly (a global identifier can't be caught by the "imports" remap,
// which only intercepts require() specifiers). Load it first, before any
// reused module that touches `process`.
require('../lib/compat/process.js')

const WallpaperCore = require('pear-wallpaper-core')
const { selectPlatform } = require('../lib/platform/index.js')
const { createLoginItem } = require('../lib/login-item.js')
const { createSyncEngine } = require('pear-wallpaper-bridge/engine')
const { createBridgeMain } = require('pear-wallpaper-bridge/main')
const { resolveDeviceName } = require('../lib/device-name.js')
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')

// Config travels via argv, NOT `opts` — bare-sidecar's Sidecar constructor
// never reads `opts` (currently reserved/no-op; see task-2-report.md). main.js
// calls `PearRuntime.run(entry, [storageDir, exePath])`, which spawns
// `bare(entry, storageDir, exePath)` (bare-sidecar/index.js:12:
// `spawn(bare, [entry, ...args], ...)`). Inside the worker, bare's own
// bootstrap sets `Bare.argv = [bareBinaryPath, entryPath, ...args]` (verified
// empirically with a throwaway harness — see task-3-report.md), so our two
// config values are at indices 2 and 3.
const [storageDir, exePath] = Bare.argv.slice(2)
const endpoint = Bare.IPC // the worker's side of the duplex (Task 2)

async function main () {
  const deviceName = resolveDeviceName({ storageDir })
  const core = new WallpaperCore({ storageDir, deviceName })
  await core.ready()

  const platform = selectPlatform()
  const engine = createSyncEngine({ core, platform })
  // Safety 'error' listener BEFORE start() — sync-engine's EventEmitter
  // throws synchronously if 'error' is emitted with zero listeners.
  // createBridgeMain(...).start() adds its own (real) listener a few lines
  // down, but this one covers the gap from construction to then.
  engine.on('error', (err) => console.error('[worker] sync-engine error', err))

  // Login-item now targets the built .app executable (no pear/pear:// link).
  const loginItem = createLoginItem({
    label: 'com.pear-wallpaper',
    programArguments: [exePath]
  })

  const transport = createDuplexJsonTransport(endpoint)

  // Graceful shutdown. main.js sends a `{ t: 'shutdown' }` control frame
  // over this same transport on `app.before-quit` (see main.js). This is a
  // message-level signal, not a pipe-lifecycle one: empirically,
  // `workerPipe.destroy()` SIGTERMs the bare process immediately with no
  // JS-visible event in the worker (confirmed — the process dies before any
  // 'close'/'end' handler runs), and `workerPipe.end()` only half-closes
  // (the worker sees 'end' but never 'close', and the process never exits
  // on its own) — see task-3-report.md for the harness evidence. A control
  // frame is the only reliable way to run `engine.stop()`/`core.close()`
  // before the process goes away. bridge-main's own onMessage handler
  // ignores anything that isn't `{ t: 'req' }`, so this is additive.
  let shuttingDown = false
  transport.onMessage(async (msg) => {
    if (!msg || msg.t !== 'shutdown' || shuttingDown) return
    shuttingDown = true
    try {
      engine.stop()
      await core.close()
    } catch (err) {
      console.error('[worker] error during shutdown', err)
    } finally {
      Bare.exit()
    }
  })

  createBridgeMain({ core, platform, loginItem, engine, transport }).start()
  engine.start()
}
main().catch((err) => { console.error('[worker] fatal', err); Bare.exit(1) })
