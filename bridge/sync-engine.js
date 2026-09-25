// 'events' has no Bare builtin (unlike Node) — package.json's "imports"
// field remaps it to bare-events under the "bare" condition (same pattern
// hyperswarm/hyperdht use for themselves), so this same require resolves
// correctly whether this module runs under Node (desktop test suite,
// future RN Metro) or Bare (desktop worker, Android worklet).
const EventEmitter = require('events')

function createSyncEngine ({ core, platform = null, intervalMs = 180000 }) {
  const ee = new EventEmitter()
  let timer = null
  let wallpaperHandler = null
  let applying = false
  let queued = false
  function stampSynced () {
    engine.lastSync = Date.now()
    ee.emit('synced')
  }
  const engine = {
    lastSync: null,
    on: ee.on.bind(ee),
    async applyPending () {
      // Android: apply is RN-side (spec §3.2); the sync loop still runs
      // (syncNow still calls core.sync() and stamps lastSync) but there is
      // no platform.setWallpaper to call here.
      if (!platform) return
      // Coalesce concurrent triggers: never run two apply passes at once.
      if (applying) { queued = true; return }
      applying = true
      try {
        while (true) {
          let item
          try {
            item = await core.pendingWallpaper()
          } catch (err) {
            ee.emit('error', err) // surface via 'error', never throw out of applyPending
            break
          }
          if (!item) break
          try {
            await platform.setWallpaper(item.filePath)
          } catch (err) {
            ee.emit('error', err) // leave unacked -> retried next trigger
            break
          }
          try {
            await core.markApplied(item.id)
          } catch (err) {
            ee.emit('error', err) // ack failed -> may re-apply, but never throw
            break
          }
          ee.emit('applied', { id: item.id })
        }
      } finally {
        applying = false
        if (queued) {
          queued = false
          this.applyPending().catch((err) => ee.emit('error', err))
        }
      }
    },
    async syncNow () {
      try {
        await core.sync()
        stampSynced()
      } catch (err) {
        ee.emit('error', err)
      }
      await this.applyPending()
    },
    start () {
      // A wallpaper arriving over live replication is the group reaching
      // this device between timer syncs, which is what "last synced" means
      // to someone looking at the screen.
      wallpaperHandler = () => {
        stampSynced()
        engine.applyPending().catch((err) => ee.emit('error', err))
      }
      core.on('wallpaper', wallpaperHandler)
      timer = setInterval(() => { engine.syncNow().catch((err) => ee.emit('error', err)) }, intervalMs)
      if (timer.unref) timer.unref()
    },
    stop () {
      if (timer) clearInterval(timer)
      timer = null
      if (wallpaperHandler) { core.removeListener('wallpaper', wallpaperHandler); wallpaperHandler = null }
    }
  }
  return engine
}

module.exports = { createSyncEngine }
