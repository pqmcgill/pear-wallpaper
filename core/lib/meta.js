const Hyperbee = require('hyperbee')

// Local-only KV on a named (never shared, never announced) core.
class LocalMeta {
  constructor(store) {
    this.bee = new Hyperbee(store.get({ name: 'local-meta' }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
  }

  ready() {
    return this.bee.ready()
  }

  async get(key) {
    const node = await this.bee.get(key)
    return node === null ? null : node.value
  }

  put(key, value) {
    return this.bee.put(key, value)
  }

  del(key) {
    return this.bee.del(key)
  }

  close() {
    return this.bee.close()
  }
}

module.exports = LocalMeta
