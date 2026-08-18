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

  async get(ref) {
    if (ref.core === this.localKey) return this.local.get(ref.id)
    let blobs = this._remotes.get(ref.core)
    if (!blobs) {
      const core = this.store.get(b4a.from(ref.core, 'hex'))
      await core.ready()
      blobs = new Hyperblobs(core)
      this._remotes.set(ref.core, blobs)
    }
    return blobs.get(ref.id) // waits for the download over any replicating connection
  }

  async close() {
    // cores are owned by the corestore; nothing extra to close
  }
}

module.exports = BlobStore
