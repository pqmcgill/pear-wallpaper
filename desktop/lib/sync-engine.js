const EventEmitter = require('events')

function createSyncEngine ({ core, platform, intervalMs = 180000 }) {
  const ee = new EventEmitter()
  let timer = null
  let wallpaperHandler = null
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
      try { await core.sync() } catch (err) { ee.emit('error', err) }
      this.lastSync = Date.now()
      await this.applyPending()
    },
    start () {
      wallpaperHandler = () => { engine.applyPending().catch((err) => ee.emit('error', err)) }
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
