const Hyperblobs = require('hyperblobs')
const b4a = require('b4a')

// One writable blobs core per device; remote refs resolved through the
// same corestore (replication over gated connections does the transfer).
class BlobStore {
  constructor(store) {
    this.store = store
    this.local = null
    this._remotes = new Map() // coreKeyHex → Hyperblobs
  }

  async ready() {
    const core = this.store.get({ name: 'blobs' })
    await core.ready()
    this.local = new Hyperblobs(core)
    this.localKey = b4a.toString(core.key, 'hex')
  }

  async put(buffer) {
    const id = await this.local.put(buffer)
    return { core: this.localKey, id }
  }

  // timeoutMs = 0 (default) waits forever, matching hyperblobs'/hypercore's
  // own default. A caller that can't afford to wedge on a revoked sender,
  // an offline peer, or a garbage ref (receive/relay loops) passes a bound
  // and treats rejection as "stays pending, retry next update" (spec §6).
  async get(ref, { timeoutMs = 0 } = {}) {
    if (ref.core === this.localKey) return this.local.get(ref.id, { timeout: timeoutMs })
    let blobs = this._remotes.get(ref.core)
    if (!blobs) {
      const core = this.store.get(b4a.from(ref.core, 'hex'))
      await core.ready()
      blobs = new Hyperblobs(core)
      this._remotes.set(ref.core, blobs)
    }
    return blobs.get(ref.id, { timeout: timeoutMs }) // waits (bounded) for the download over any replicating connection
  }

  async close() {
    // cores are owned by the corestore; nothing extra to close
  }
}

module.exports = BlobStore
