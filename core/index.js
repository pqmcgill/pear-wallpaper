const Corestore = require('corestore')
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const b4a = require('b4a')
const LocalMeta = require('./lib/meta.js')
const { apply, k } = require('./lib/apply.js')
const ops = require('./lib/ops.js')

class WallpaperCore extends ReadyResource {
  constructor({ storageDir, deviceName, bootstrap = null }) {
    super()
    if (!storageDir || !deviceName) throw new Error('storageDir and deviceName are required')
    this.storageDir = storageDir
    this.deviceName = deviceName
    this.bootstrap = bootstrap // null in production; testnet bootstrap in tests

    this.store = new Corestore(storageDir + '/corestore')
    this.meta = new LocalMeta(this.store)
    this.base = null
    this.swarm = null
    this._joining = false
    this._deviceKey = null
  }

  get deviceKey() {
    return this._deviceKey
  }

  get groupStatus() {
    if (this.base !== null) return 'member'
    return this._joining ? 'joining' : 'none'
  }

  async _open() {
    await this.store.ready()
    await this.meta.ready()
    // The device identity is its autobase local-writer key: the same key
    // that appears in the roster and in send targets.
    const local = Autobase.getLocalCore(this.store)
    await local.ready()
    this._deviceKey = b4a.toString(local.key, 'hex')
    await local.close()

    const group = await this.meta.get('group')
    if (group !== null) {
      this._boot(group)
      await this.base.ready()
      await this._startSwarm()
    }
  }

  _boot({ key = null, encryptionKey = null } = {}) {
    this.base = new Autobase(this.store, key ? b4a.from(key, 'hex') : null, {
      encrypt: true,
      encryptionKey: encryptionKey ? b4a.from(encryptionKey, 'hex') : undefined,
      valueEncoding: 'json',
      open: (store) =>
        new Hyperbee(store.get('view'), {
          extension: false,
          keyEncoding: 'utf-8',
          valueEncoding: 'json'
        }),
      apply
    })
    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
    this.on('update', () => this.emit('roster-changed')) // refined in Task 10
  }

  async createGroup() {
    if (this.opened === false) await this.ready()
    if (this.base !== null || this._joining) throw new Error('already in a group (or joining one)')
    this._boot()
    await this.base.ready()
    await this._startSwarm() // no-op until Task 4 fills it in; define as `async _startSwarm() {}`
    await this._append(ops.addDevice({
      key: this.deviceKey,
      swarmKey: await this._swarmKeyHex(),
      name: this.deviceName,
      isCreator: true
    }))
    await this.meta.put('group', {
      key: b4a.toString(this.base.key, 'hex'),
      encryptionKey: b4a.toString(this.base.encryptionKey, 'hex')
    })
  }

  _append(op) {
    return this.base.append(op)
  }

  async _swarmKeyHex() {
    const kp = await this.store.createKeyPair('hyperswarm')
    return b4a.toString(kp.publicKey, 'hex')
  }

  async listDevices() {
    if (this.base === null) return []
    const out = []
    for await (const node of this.base.view.createReadStream({ gte: 'device/', lt: 'device0' })) {
      out.push({
        key: node.value.key,
        name: node.value.name,
        isSelf: node.value.key === this.deviceKey,
        isCreator: node.value.isCreator,
        online: this._isOnline(node.value.swarmKey) // stub `_isOnline() { return false }` until Task 4
      })
    }
    return out
  }

  async _startSwarm() {} // no-op until Task 4 fills it in

  _isOnline() { return false } // stub until Task 4 fills it in

  async _close() {
    if (this.swarm !== null) await this.swarm.destroy()
    if (this.base !== null) await this.base.close()
    await this.meta.close()
    await this.store.close()
  }
}

module.exports = WallpaperCore
