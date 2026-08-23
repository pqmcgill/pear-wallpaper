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
        // Init failure is TERMINAL, mirroring desktop/worker/core-host.js's
        // Bare.exit(1) — `started` is never reset, so a second init frame
        // would otherwise be silently ignored forever (any caller awaiting
        // 'ready' would hang). Recovery is relaunching the worklet, never
        // re-sending init on the same instance (Task 4's worklet-client.js
        // relies on this: on 'error' it treats the worklet as dead).
        console.error('[worklet] init failed', err)
        transport.send({ t: 'evt', event: 'error', payload: { message: err.message } })
        exit(1)
      }
      return
    }
    // Message-level shutdown, mirroring desktop: used by Task 9's bounded
    // background rounds so corestore closes cleanly before terminate().
    if (msg.t === 'shutdown') {
      try {
        if (engine) engine.stop()
        if (core) await core.close()
      } catch (err) {
        console.error('[worklet] error during shutdown', err)
      } finally {
        exit(0)
      }
    }
  })
}
module.exports = { createCoreHost }
