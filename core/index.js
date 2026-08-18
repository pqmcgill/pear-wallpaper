const Corestore = require('corestore')
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const BlindPairing = require('blind-pairing')
const z32 = require('z32')
const c = require('compact-encoding')
const b4a = require('b4a')
const LocalMeta = require('./lib/meta.js')
const { apply, k } = require('./lib/apply.js')
const ops = require('./lib/ops.js')
const { requestJoin } = require('./lib/pairer.js')

const HEX64 = /^[0-9a-f]{64}$/
const INVITE_TTL_MS = 24 * 60 * 60 * 1000

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
    this.pairing = null
    this.member = null
    this._pending = null
    this._connections = null
    this._joining = false
    this._activeJoin = null // { invite, candidate, candidateReady, reject, promise } while joinGroup is in flight
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

    if (this.base === null) {
      const pending = await this.meta.get('pending-invite')
      if (pending !== null) this.joinGroup(pending.invite).catch(() => this.emit('error-joining'))
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
    await this._startSwarm()
    await this._append(ops.addDevice({
      key: this.deviceKey,
      swarmKey: await this._swarmKeyHex(),
      name: this.deviceName
    }))
    await this.meta.put('group', {
      key: b4a.toString(this.base.key, 'hex'),
      encryptionKey: b4a.toString(this.base.encryptionKey, 'hex')
    })
  }

  async _startPairingSwarm() {
    if (this.swarm !== null) return
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })
    this._connections = new Map()
    this.swarm.on('connection', (conn) => this._onConnection(conn))
    this.pairing = new BlindPairing(this.swarm)
  }

  async joinGroup(invite) {
    if (this.opened === false) await this.ready()
    if (this.base !== null) throw new Error('already in a group')

    // Same invite already in flight: hand back the existing attempt
    // rather than opening a second candidate for the same discovery key
    // (blind-pairing throws 'Active candidate already exist' on that).
    if (this._activeJoin !== null) {
      if (this._activeJoin.invite === invite) return this._activeJoin.promise
      await this._supersede(this._activeJoin)
    }

    let resolveCandidateReady, rejectCandidateReady
    const candidateReady = new Promise((resolve, reject) => {
      resolveCandidateReady = resolve
      rejectCandidateReady = reject
    })
    const activeJoin = { invite, candidate: null, candidateReady, reject: null, promise: null }
    this._activeJoin = activeJoin
    this._joining = true
    activeJoin.promise = this._runJoin(invite, activeJoin, resolveCandidateReady, rejectCandidateReady)
    return activeJoin.promise
  }

  // Force-settle a stale/superseded join: reject its pairing promise (so
  // the suspended _runJoin frame awaiting it unblocks instead of leaking
  // for the process lifetime — blind-pairing's Candidate.close() neither
  // fires onadd nor emits 'rejected', so nothing else would ever wake it),
  // close its candidate, then wait for _runJoin's own catch/finally to
  // fully drain (pending-invite cleanup, _joining reset) before returning.
  // Waits (briefly, bounded — candidate creation is local-only: corestore
  // + keypair derivation, no network round trip) for the candidate to
  // exist first, so settling that lands in the narrow window before
  // `requestJoin` returns doesn't leak an untracked, still-polling
  // Candidate.
  async _settleJoin(stale, err) {
    await stale.candidateReady.catch(() => {})
    if (stale.reject) stale.reject(err)
    if (stale.candidate) await stale.candidate.close().catch(() => {})
    await stale.promise.catch(() => {})
  }

  _supersede(stale) {
    return this._settleJoin(stale, new Error('superseded by a newer invite'))
  }

  async _runJoin(invite, activeJoin, resolveCandidateReady, rejectCandidateReady) {
    try {
      await this.meta.put('pending-invite', { invite }) // restart resume
      const { candidate, promise, reject } = await requestJoin(this, invite)
      activeJoin.candidate = candidate
      activeJoin.reject = reject
      resolveCandidateReady()

      const result = await promise
      this._boot(result)
      await this.base.ready()
      // become a full member: wait until our writer was added
      if (typeof this.base.waitForWritable === 'function') {
        await this.base.waitForWritable()
      } else {
        await new Promise((resolve) => {
          if (this.base.writable) return resolve()
          const check = () => {
            if (!this.base.writable) return
            this.base.off('update', check)
            resolve()
          }
          this.base.on('update', check)
        })
      }
      this._pending = new Map()
      this.member = this.pairing.addMember({
        discoveryKey: this.base.discoveryKey,
        onadd: (candidate2) => this._onCandidate(candidate2)
      })
      this.swarm.join(this.base.discoveryKey)
      await this.meta.put('group', {
        key: b4a.toString(this.base.key, 'hex'),
        encryptionKey: b4a.toString(this.base.encryptionKey, 'hex')
      })
      await this._clearPendingInviteIfStillMine(invite)
      await candidate.close().catch(() => {})
    } catch (err) {
      rejectCandidateReady(err) // no-op if candidateReady already settled
      // A newer joinGroup() call may already have persisted its OWN
      // pending-invite by the time this stale attempt's cleanup runs
      // (e.g. under _close(), which doesn't serialize against a fresh
      // joinGroup() the way supersede does) — never delete a pending-
      // invite record that isn't this run's own.
      await this._clearPendingInviteIfStillMine(invite)
      throw err
    } finally {
      this._joining = false
      if (this._activeJoin === activeJoin) this._activeJoin = null
    }
  }

  async _clearPendingInviteIfStillMine(invite) {
    try {
      const pending = await this.meta.get('pending-invite')
      if (pending !== null && pending.invite === invite) await this.meta.del('pending-invite')
    } catch {
      // best-effort cleanup only — never let this mask the real error
    }
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
        online: this._isOnline(node.value.swarmKey)
      })
    }
    return out
  }

  async _startSwarm() {
    if (this.swarm !== null) return
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })
    this._connections = new Map() // swarmKeyHex → connection
    this.swarm.on('connection', (conn) => this._onConnection(conn))

    this.pairing = new BlindPairing(this.swarm)
    this._pending = new Map()
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (candidate) => this._onCandidate(candidate)
    })
    this.swarm.join(this.base.discoveryKey)
  }

  _onConnection(conn) {
    const remote = b4a.toString(conn.remotePublicKey, 'hex')
    this._connections.set(remote, conn)
    conn.on('close', () => {
      if (this._connections.get(remote) === conn) this._connections.delete(remote)
      this.emit('roster-changed') // online flags changed
    })
    this.store.replicate(conn) // replicates the base AND blob cores (Task 7)
    this.emit('roster-changed')
  }

  _isOnline(swarmKeyHex) {
    return this._connections ? this._connections.has(swarmKeyHex) : false
  }

  async _onCandidate(candidate) {
    // AUTHORIZATION GATE — deliberate deviation from autopass, which
    // auto-admits any valid invite holder. We hold the candidate and
    // wait for an explicit approve()/deny() (Task 5).
    //
    // Defense in depth: only the creator ever confirms a candidate, even
    // though every member installs this handler (Task 5's approve() will
    // also be creator-gated, but a stale/unconsumed invite view-record
    // shouldn't let a non-creator member act on it in the meantime).
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || self.value.isCreator !== true) return

    const inv = await this.base.view.get(k.invite)
    if (inv === null || inv.value.id !== b4a.toString(candidate.inviteId, 'hex')) return
    if (inv.value.expires !== 0 && Date.now() > inv.value.expires) return // invite expired

    candidate.open(b4a.from(inv.value.publicKey, 'hex'))

    // candidate.userData is attacker-controlled bytes from any invite
    // holder — never let a malformed payload throw out of this handler
    // (blind-pairing's safety-catch re-throws SyntaxError/TypeError as
    // uncaught exceptions, which would kill the process).
    let payload
    try {
      payload = JSON.parse(b4a.toString(candidate.userData))
    } catch {
      return
    }
    const { key, swarmKey, name } = payload || {}
    if (!HEX64.test(key) || !HEX64.test(swarmKey)) return
    if (typeof name !== 'string' || name.length < 1 || name.length > 64) return

    // A second candidate on the same invite must not silently replace the
    // entry the human was already shown via 'pairing-request'.
    if (this._pending.has(key)) return

    // blind-pairing's Member._addRequest awaits this handler's returned
    // promise and, once it settles, checks candidate.response to decide
    // whether to send anything back at all — so this must stay pending
    // until approve()/deny() has actually called confirm()/deny() on the
    // candidate. Resolving early (e.g. right after emit()) would let
    // _addRequest see a still-empty response and drop the reply, silently
    // stranding the joiner. approve()/deny() call `settle()` once done.
    let settle
    const decided = new Promise((resolve) => { settle = resolve })
    this._pending.set(key, { candidate, key, swarmKey, name, settle })
    this.emit('pairing-request', { candidateKey: key, name })
    await decided
  }

  async createInvite() {
    if (this.opened === false) await this.ready()
    if (this.base === null) throw new Error('not in a group')
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || !self.value.isCreator) throw new Error('only the creator can invite')

    const existing = await this.base.view.get(k.invite)
    if (existing !== null) {
      if (this.member) await this.member.flushed()
      return z32.encode(b4a.from(existing.value.invite, 'hex'))
    }
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key, {
      expires: Date.now() + INVITE_TTL_MS
    })
    await this._append(ops.addInvite({
      id: b4a.toString(id, 'hex'),
      invite: b4a.toString(invite, 'hex'),
      publicKey: b4a.toString(publicKey, 'hex'),
      expires
    }))
    if (this.member) await this.member.flushed()
    return z32.encode(invite)
  }

  async approve(candidateKey) {
    const pending = this._pending.get(candidateKey)
    if (!pending) throw new Error('no pending candidate with that key')
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || !self.value.isCreator) throw new Error('only the creator can approve')

    await this._append(ops.addDevice({
      key: pending.key,
      swarmKey: pending.swarmKey,
      name: pending.name
    }))
    // The stored invite record has no `additional` field (createInvite is
    // never called with `data`) — pass it explicitly as null rather than
    // reference `inv.value.additional`, which doesn't exist. See Task 4/5
    // divergence notes.
    pending.candidate.confirm({
      key: this.base.key,
      encryptionKey: this.base.encryptionKey,
      additional: null
    })
    this._pending.delete(candidateKey)
    await this._append(ops.delInvite()) // single-use: an invite admits one device
    pending.settle() // let the awaiting _onCandidate return, so blind-pairing sends the reply
  }

  async deny(candidateKey) {
    const pending = this._pending.get(candidateKey)
    if (!pending) throw new Error('no pending candidate with that key')
    // Investigated (Task 5): blind-pairing-core's MemberRequest exposes an
    // explicit deny() that encodes and sends a PAIRING_REJECTED response,
    // which the candidate's CandidateRequest.handleResponse() turns into a
    // 'rejected' event on candidate.request — already wired in pairer.js
    // to reject joinGroup()'s promise. So a denied joiner's joinGroup call
    // rejects instead of hanging until superseded.
    pending.candidate.deny()
    this._pending.delete(candidateKey)
    await this._append(ops.delInvite()) // burn it: deny means this invite is compromised/unwanted
    pending.settle() // let the awaiting _onCandidate return, so blind-pairing sends the reply
  }

  async _close() {
    if (this._activeJoin !== null) {
      const stale = this._activeJoin
      this._activeJoin = null
      await this._settleJoin(stale, new Error('closed'))
    }
    if (this.pairing !== null) await this.pairing.close().catch(() => {})
    if (this.swarm !== null) await this.swarm.destroy()
    if (this.base !== null) await this.base.close()
    await this.meta.close()
    await this.store.close()
  }
}

module.exports = WallpaperCore
