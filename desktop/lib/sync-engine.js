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
