const Hyperblobs = require('hyperblobs')
const b4a = require('b4a')

const HEX64 = /^[0-9a-f]{64}$/

// Refs travel inside `set-wallpaper` ops, so they are only as trustworthy
// as the member that appended them. Validate before handing anything to
// corestore/hyperblobs: an unchecked `ref.core` reaches
// hypercore-id-encoding, which throws a raw 'ID must be 32-bytes long'
// straight out of BlobStore.get (and, on the pull path, out of
// pendingWallpaper). A malformed ref must be a clear, catchable error that
// callers turn into a permanent skip.
function validateRef(ref) {
  if (ref === null || typeof ref !== 'object') throw new Error('invalid blob ref')
  if (typeof ref.core !== 'string' || !HEX64.test(ref.core)) throw new Error('invalid blob ref: core')
  const id = ref.id
  if (id === null || typeof id !== 'object') throw new Error('invalid blob ref: id')
  for (const field of ['blockOffset', 'blockLength', 'byteOffset', 'byteLength']) {
    if (!Number.isInteger(id[field]) || id[field] < 0) throw new Error(`invalid blob ref: id.${field}`)
  }
}

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
    validateRef(ref)
    const blobs = await this._blobs(ref)
    return blobs.get(ref.id, { timeout: timeoutMs }) // waits (bounded) for the download over any replicating connection
  }

  // Is this ref already fully downloaded locally? Lets the relay sweep skip
  // blobs it already holds instead of re-fetching them every update (and
  // stops it re-sweeping forever-unacked sends to revoked devices).
  // Deliberately never throws: an unusable ref is simply "not held", and
  // get() is the one place that reports why.
  async has(ref) {
    try {
      validateRef(ref)
      if (ref.id.blockLength === 0) return true // nothing to download
      const blobs = await this._blobs(ref)
      return await blobs.core.has(ref.id.blockOffset, ref.id.blockOffset + ref.id.blockLength)
    } catch {
      return false
    }
  }

  // Drop this ref's blocks from local storage. hypercore's clear frees the
  // bytes and unsets the bitfield; the core's length and tree stay, so the
  // same blocks can be fetched again from any peer that still has them.
  async clear(ref) {
    validateRef(ref)
    if (ref.id.blockLength === 0) return
    const blobs = await this._blobs(ref)
    await blobs.clear(ref.id)
  }

  async _blobs(ref) {
    if (ref.core === this.localKey) return this.local
    let blobs = this._remotes.get(ref.core)
    if (!blobs) {
      const core = this.store.get(b4a.from(ref.core, 'hex'))
      await core.ready()
      blobs = new Hyperblobs(core)
      this._remotes.set(ref.core, blobs)
    }
    return blobs
  }

  async close() {
    // cores are owned by the corestore; nothing extra to close
  }
}

module.exports = BlobStore
