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
