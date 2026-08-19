'use strict'
/* global Pear, Bare */
const path = require('path')
const WallpaperCore = require('pear-wallpaper-core')
const Runtime = require('pear-electron')
const Bridge = require('pear-bridge')
const { selectPlatform } = require('./lib/platform/index.js')
const { createLoginItem } = require('./lib/login-item.js')
const { createLock } = require('./lib/single-instance.js')
const { createSyncEngine } = require('./lib/sync-engine.js')
const { createBridgeMain } = require('./lib/bridge-main.js')
const { resolveDeviceName } = require('./lib/device-name.js')
const { createPearTransportMain } = require('./lib/pear-transport.js')

async function main () {
  const storageDir = Pear.config.storage // per-app, stable across updates

  // Single instance: a second `pear run` on the same storage refuses here,
  // before anything (core, network, window) is touched.
  const lock = createLock(path.join(storageDir, 'app.lock'))
  if (!lock.acquire()) {
    console.error('[pear-wallpaper] another instance is already running; exiting')
    Pear.exit(0)
    return
  }

  const deviceName = resolveDeviceName({ storageDir })
  const core = new WallpaperCore({ storageDir, deviceName })
  await core.ready()
  console.log('[pear-wallpaper] booted; deviceKey=', core.deviceKey, 'status=', core.groupStatus)

  const platform = selectPlatform()
  const engine = createSyncEngine({ core, platform })
  // Critical wiring (carried over from Task 5/7): sync-engine emits 'error'
  // via a plain EventEmitter, which THROWS SYNCHRONOUSLY if emitted with
  // zero listeners. createBridgeMain(...).start() attaches the "real"
  // listener (forwarding to the ui as an {message} event), but that only
  // happens a few lines below, after the transport/bridge exist. Attach a
  // safety listener the moment the engine is constructed — before
  // engine.start() runs and before any async gap — so there is never a
  // window with zero 'error' listeners. (Bridge-main's own listener is
  // additive, not a replacement; both fire.)
  engine.on('error', (err) => console.error('[pear-wallpaper] sync-engine error', err))

  // Best-effort resolution of the pear/bare binary for the login item's
  // ProgramArguments. Under `pear run`, this process is hosted by Bare, and
  // `Bare.argv[0]` should be the actual `pear` binary invoked; `process.execPath`
  // is a fallback (e.g. if this ever runs under a plain Node host). NOT
  // verified against a staged build — see task-9-report.md.
  const pearBin = (typeof Bare !== 'undefined' && Bare.argv && Bare.argv[0]) || process.execPath
  const loginItem = createLoginItem({
    label: 'com.pear-wallpaper',
    programArguments: [pearBin, 'run', `pear://${Pear.config.key || ''}`]
  })

  // Window creation, per pear-electron README (v1.7.28): the main
  // entrypoint pairs a pear-bridge instance (serves ui/ assets over local
  // HTTP) with the pear-electron Runtime, which spawns/boots the actual
  // Electron UI process. `runtime.start()` returns the parent<->child
  // duplex pipe (fd 3, backed by the `pear-pipe` dependency) — this is also
  // the transport channel bridge-main uses to reach the renderer. See
  // lib/pear-transport.js for why `ui.app`/`win.send` cannot be used from
  // this process (they only exist inside the spawned Electron process).
  const bridge = new Bridge()
  await bridge.ready()
  const runtime = new Runtime()
  const pipe = runtime.start({ bridge })

  const transport = createPearTransportMain(pipe)
  // Start the bridge (attaching its engine 'error'/'applied' listeners)
  // before engine.start(), per the critical wiring note above.
  createBridgeMain({ core, platform, loginItem, engine, transport }).start()
  engine.start()

  Pear.teardown(async () => {
    engine.stop()
    lock.release()
    try { pipe.end() } catch { /* already closed */ }
    await core.close()
  })
}

main().catch((err) => { console.error(err); Pear.exit(1) })
