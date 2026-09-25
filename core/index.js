const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const BlindPairing = require('blind-pairing')
const z32 = require('z32')
const b4a = require('b4a')
const LocalMeta = require('./lib/meta.js')
const BlobStore = require('./lib/blobs.js')
const { apply, k } = require('./lib/apply.js')
const ops = require('./lib/ops.js')
const { requestJoin } = require('./lib/pairer.js')
const { validateImage } = require('./lib/image.js')

const HEX64 = /^[0-9a-f]{64}$/
const INVITE_TTL_MS = 24 * 60 * 60 * 1000

function noop() {}

// meta.filename replicates to every member, so only the last path segment
// ever leaves this device.
function baseName(name) {
  if (typeof name !== 'string') return null
  return name.split(/[\\/]/).pop() || null
}

// Run `run` at most once at a time. A call that arrives while one is in
// flight marks the gate dirty, and the sweep runs once more when it
// finishes, so an op that landed mid-sweep is picked up right away instead
// of waiting for some unrelated op to trigger the next one. A rejected run
// (the routine "no peer can serve this blob yet" case) must not skip that
// re-run, so it is swallowed here rather than at the call site.
async function sweep(gate, run) {
  if (gate.busy) { gate.dirty = true; return }
  gate.busy = true
  try {
    do {
      gate.dirty = false
      await run().catch(noop)
    } while (gate.dirty)
  } finally {
    gate.busy = false
  }
}

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
    this.blobs = null
    this.swarm = null
    this.pairing = null
    this.member = null
    this._pending = null
    this._connections = null
    // Connections we have attached store.replicate() to. Keyed on the
    // stream object, not the remote key: store.replicate must run at most
    // once per stream, and a reconnecting peer arrives as a NEW stream
    // under the same key. WeakSet so a dropped connection needs no cleanup.
    this._replicating = new WeakSet()
    this._joining = false
    this._activeJoin = null // { invite, candidate, candidateReady, reject, promise, interrupted } while a join is in flight
    this._deviceKey = null
    this._receiveGate = { busy: false, dirty: false } // see sweep()
    this._lastEmitted = null
    this._materializing = new Map() // send id -> in-flight _materialize promise
    this._lastDevices = null // Task 10: cached device-row keys, for diffing on update
    this._lastAcks = null // Task 10: cached ack-row keys, for diffing on update
    this._relayGate = { busy: false, dirty: false } // see sweep()
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
      await this.blobs.ready()
      await this._startSwarm()
    }

    if (this.base === null) {
      const pending = await this.meta.get('pending-invite')
      // _startJoin, not joinGroup: joinGroup would park on ready() (we are
      // still inside _open), leaving one tick after ready() resolves where
      // a mid-join device reads groupStatus 'none'.
      if (pending !== null) this._startJoin(pending.invite).catch(() => this.emit('error-joining'))
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
    this.blobs = new BlobStore(this.store)
    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
    this.on('update', () => { this._checkRosterAndAcks().catch(noop) })
    this.on('roster-changed', () => this._enforceGate().catch(() => {}))
    this.on('update', () => { this._checkIncoming().catch(noop) })
    this.on('update', () => { this._relayBlobs().catch(noop) })
  }

  async createGroup() {
    if (this.opened === false) await this.ready()
    if (this.base !== null || this._joining) throw new Error('already in a group (or joining one)')
    this._boot()
    await this.base.ready()
    await this.blobs.ready()
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
    return this._startJoin(invite)
  }

  // Marks the join in flight synchronously (groupStatus reads 'joining'
  // from here on) and runs it.
  _startJoin(invite) {
    let resolveCandidateReady, rejectCandidateReady
    const candidateReady = new Promise((resolve, reject) => {
      resolveCandidateReady = resolve
      rejectCandidateReady = reject
    })
    const activeJoin = { invite, candidate: null, candidateReady, reject: null, promise: null, interrupted: false }
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
      await this.blobs.ready()
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
      // Every natural failure lands here (denied / invite used / expired),
      // and _activeJoin is nulled in the finally below — so a candidate left
      // open here is unreachable AND still announcing, re-polling the DHT
      // every ~7min for the process lifetime. Android's restart-resume
      // (_open's pending-invite replay) accumulates one per failed attempt.
      // Idempotent: the supersede path may already have closed it.
      if (activeJoin.candidate !== null) await activeJoin.candidate.close().catch(() => {})
      // A close() is not a failure: the invite is still good, and the
      // pending-invite record is what lets the next open resume this join.
      // Only a real outcome (denied / used / expired / superseded) retires it.
      // A newer joinGroup() call may already have persisted its OWN
      // pending-invite by the time this stale attempt's cleanup runs
      // (e.g. under _close(), which doesn't serialize against a fresh
      // joinGroup() the way supersede does) — never delete a pending-
      // invite record that isn't this run's own.
      if (!activeJoin.interrupted) await this._clearPendingInviteIfStillMine(invite)
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
      const isSelf = node.value.key === this.deviceKey
      out.push({
        key: node.value.key,
        name: node.value.name,
        isSelf,
        isCreator: node.value.isCreator,
        // The swarm never holds a connection to itself, so self would
        // otherwise always read offline.
        online: isSelf || this._isOnline(node.value.swarmKey)
      })
    }
    return out
  }

  async sendWallpaper(image, targets, { filename = typeof image === 'string' ? image : null } = {}) {
    if (this.base === null) throw new Error('not in a group')
    if (!Array.isArray(targets) || targets.length === 0) throw new Error('targets required')
    const buffer = typeof image === 'string' ? await fs.promises.readFile(image) : image
    const ext = validateImage(buffer)
    for (const key of targets) {
      if ((await this.base.view.get(k.device(key))) === null) throw new Error(`target ${key} is not in the roster`)
    }
    const blob = await this.blobs.put(buffer)
    const op = ops.setWallpaper({
      from: this.deviceKey,
      targets,
      blob,
      meta: { ext, byteLength: buffer.byteLength, filename: baseName(filename) }
    })
    await this._append(op)
    return { id: op.id }
  }

  async listSends({ limit = 20 } = {}) {
    if (this.base === null) return []
    const sends = []
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      // THIS device's sent history (README) — the send/ range holds every
      // member's sends, and a peer's send must never appear here as ours.
      if (node.value.from !== this.deviceKey) continue
      sends.push(node.value)
    }
    sends.sort((a, b) => b.seq - a.seq)
    const out = []
    for (const s of sends.slice(0, limit)) {
      const targets = []
      for (const key of s.targets) {
        targets.push({ key, status: await this._targetStatus(s, key) })
      }
      out.push({ id: s.id, meta: s.meta, sentAt: s.sentAt, targets })
    }
    return out
  }

  async markApplied(id) {
    if (this.base === null) throw new Error('not in a group')
    const send = await this.base.view.get(k.send(id))
    if (send === null) throw new Error('unknown send')
    if (!send.value.targets.includes(this.deviceKey)) throw new Error('not a target of this send')
    await this._append(ops.applied({ sendId: id, device: this.deviceKey }))
  }

  async _targetStatus(send, targetKey) {
    const ack = await this.base.view.get(k.ack(send.id, targetKey))
    if (ack !== null) return 'delivered'
    // superseded: the target applied a NEWER send — this one will never apply
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const other = node.value
      if (other.seq <= send.seq || !other.targets.includes(targetKey)) continue
      if ((await this.base.view.get(k.ack(other.id, targetKey))) !== null) return 'superseded'
    }
    return 'pending'
  }

  async listReceived({ limit = 10 } = {}) {
    if (this.base === null) return []
    const out = []
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const s = node.value
      if (!s.targets.includes(this.deviceKey)) continue
      const ack = await this.base.view.get(k.ack(s.id, this.deviceKey))
      if (ack === null) continue
      out.push({
        id: s.id, fromKey: s.from, meta: s.meta,
        filePath: path.join(this.storageDir, 'received', s.id + s.meta.ext),
        appliedAt: ack.value.appliedAt
      })
    }
    out.sort((a, b) => b.appliedAt - a.appliedAt)
    return out.slice(0, limit)
  }

  // Scoped events (Task 10): replaces the Task 3 blanket 'roster-changed'
  // re-emit on every 'update'. Two quick key-only scans (device/ and ack/),
  // diffed against the previous run's cached key lists. 'roster-changed'
  // fires only when the device-row set actually changed (online-flag
  // changes still emit it separately, from _onConnection). 'send-updated'
  // fires once per NEW ack row whose send this device authored — so a
  // sender learns exactly when one of its own sends gets acked, without
  // re-emitting for acks already accounted for on a prior run. The first
  // run after boot only seeds the caches: emitting for pre-existing acks
  // (e.g. replayed history on startup) would be spurious noise, not news.
  async _checkRosterAndAcks() {
    if (this.base === null) return
    const devices = []
    for await (const node of this.base.view.createReadStream({ gte: 'device/', lt: 'device0' })) {
      devices.push(node.key)
    }
    const acks = []
    for await (const node of this.base.view.createReadStream({ gte: 'ack/', lt: 'ack0' })) {
      acks.push(node.key)
    }

    if (this._lastDevices === null) {
      // First run: seed the baseline, emit nothing yet.
      this._lastDevices = devices
      this._lastAcks = acks
      return
    }

    const devicesChanged = devices.length !== this._lastDevices.length ||
      devices.some((key, i) => key !== this._lastDevices[i])
    if (devicesChanged) this.emit('roster-changed')

    const previousAcks = new Set(this._lastAcks)
    const newAckKeys = acks.filter((key) => !previousAcks.has(key))
    for (const ackKey of newAckKeys) {
      const sendId = ackKey.slice('ack/'.length, ackKey.lastIndexOf('/'))
      const send = await this.base.view.get(k.send(sendId))
      if (send !== null && send.value.from === this.deviceKey) {
        this.emit('send-updated', { id: sendId })
      }
    }

    this._lastDevices = devices
    this._lastAcks = acks
  }

  // Called on every base update (wired in _boot). Coalesced (see sweep): a
  // burst of updates must not stack sweeps, each doing a bounded-but-slow
  // blobs.get. sync() deliberately does NOT come through here — see _receive.
  _checkIncoming() {
    return sweep(this._receiveGate, () => this._receive())
  }

  // One receive sweep: materialize the newest send addressed to us that we
  // haven't acked, and announce it.
  //
  // Safe to run while an event-driven sweep is already in flight, which is
  // exactly what sync() needs: an update-driven sweep wedged on an
  // unfetchable blob (up to 30s) must not turn sync()'s receive step — the
  // Android shell's ONLY receive opportunity — into a silent no-op. Two
  // concurrent sweeps can't collide: _materialize dedupes per send id, and
  // the emit is guarded on _lastEmitted before AND after the await.
  async _receive() {
    if (this.base === null || this.blobs === null || !this.blobs.local) return
    const entry = await this._newestUnappliedForMe()
    if (entry === null) return
    if (this._lastEmitted === entry.id) return
    const filePath = await this._materialize(entry)
    if (this._lastEmitted === entry.id) return // a concurrent sweep announced it first
    this._lastEmitted = entry.id
    this.emit('wallpaper', { id: entry.id, filePath, fromKey: entry.from, meta: entry.meta })
  }

  // The newest send targeting us, or null once we've acked it. "Newest" is
  // over every send to us, acked or not: acking send n retires every older
  // send at once (the sender reads them as superseded, see _targetStatus),
  // so an older un-acked send must never come back here. "Unapplied" means
  // "no ack/<id>/<us> record", not "not yet materialized to disk"
  // (materialization is idempotent and re-checked in _materialize itself).
  async _newestUnappliedForMe() {
    let newest = null
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const s = node.value
      if (!s.targets.includes(this.deviceKey)) continue
      if (newest === null || s.seq > newest.seq) newest = s
    }
    if (newest === null) return null
    if ((await this.base.view.get(k.ack(newest.id, this.deviceKey))) !== null) return null
    return newest
  }

  // Fetch the blob (bounded — an unfetchable blob must not wedge the
  // receive loop) and write it atomically: .part then rename, so any
  // shell watching the received/ directory never observes a partial file.
  //
  // Dedupe on entry.id: _checkIncoming (event-driven) and pendingWallpaper
  // (pulled directly, for shells that woke up late) can both land here for
  // the same entry concurrently. Without this, both writers use the SAME
  // tmpPath (filePath + '.part') — the first rename() wins and the second
  // fails ENOENT because its .part is already gone. Share the one in-flight
  // fetch+write instead of racing two of them.
  async _materialize(entry) {
    const dir = path.join(this.storageDir, 'received')
    await fs.promises.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, entry.id + entry.meta.ext)
    try {
      await fs.promises.access(filePath)
      return filePath // already on disk
    } catch {}
    const inFlight = this._materializing.get(entry.id)
    if (inFlight) return inFlight
    const promise = this._materializeNow(entry, filePath).finally(() => {
      this._materializing.delete(entry.id)
    })
    this._materializing.set(entry.id, promise)
    return promise
  }

  async _materializeNow(entry, filePath) {
    const buffer = await this.blobs.get(entry.blob, { timeoutMs: 30000 }) // bounded: rejection = stays pending, retried next sync
    const tmpPath = filePath + '.part'
    await fs.promises.writeFile(tmpPath, buffer)
    await fs.promises.rename(tmpPath, filePath) // atomic: shells never see partial files
    return filePath
  }

  // For shells that wake up late and missed the 'wallpaper' event.
  //
  // Contract (spec §6, README): resolves to `entry | null`, NEVER a hard
  // error — the Android background recipe awaits this unguarded. The
  // mainline offline case (no online peer holds the blob yet) makes
  // _materialize's bounded blobs.get reject, and a malformed ref from a
  // compromised member rejects immediately; both are "nothing to show yet",
  // so the send simply stays unacked and is retried on the next sync.
  async pendingWallpaper() {
    if (this.base === null) return null
    const entry = await this._newestUnappliedForMe()
    if (entry === null) return null
    try {
      const filePath = await this._materialize(entry)
      return { id: entry.id, filePath, fromKey: entry.from, meta: entry.meta }
    } catch {
      return null
    }
  }

  // Download blobs for EVERY unapplied send (not just ours), so this
  // device can serve them to targets later. This is what makes any
  // online member a relay (spec §5).
  //
  // Coalesced (see sweep): this is wired to 'update' AND called from
  // sync(), so a burst of base updates (e.g. replicating several ops in
  // quick succession) would otherwise stack multiple full-relay sweeps
  // concurrently, each doing a bounded-but-slow blobs.get() per un-acked
  // send.
  _relayBlobs() {
    return sweep(this._relayGate, () => this._relayOnce())
  }

  async _relayOnce() {
    if (this.base === null || this.blobs === null || !this.blobs.local) return
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const s = node.value
      let done = true
      for (const target of s.targets) {
        if ((await this.base.view.get(k.ack(s.id, target))) === null) done = false
      }
      if (done) continue
      // Already hold every block? Nothing to fetch. Without this, each
      // update re-ran a full (bounded, but up-to-30s-per-blob) download
      // for blobs already on disk, and re-swept forever-unacked sends to
      // revoked devices for the life of the group.
      if (await this.blobs.has(s.blob)) continue
      await this.blobs.get(s.blob, { timeoutMs: 30000 }).catch(() => {}) // bounded best effort; retried next sync
    }
  }

  // Bounded sync round for shells that can't stay resident (Android
  // lifecycle): flush the swarm's pending connections, ingest whatever
  // connected peers have, relay any un-acked blobs, and materialize
  // anything now addressed to us — all raced against timeoutMs so a
  // stalled peer can never wedge the caller.
  //
  // DIVERGENCE from the brief (logged per the API-drift rule): the brief's
  // Step 3 code calls a bare `await this.base.update()` in the belief that
  // it "waits for the base to settle" over the network. Checked against
  // the installed autobase@7.28.1 source (node_modules/autobase/index.js):
  // `update()` just awaits the debounced `_bump()` -> `_advance()`, which
  // re-linearizes whatever has ALREADY arrived locally — it does not wait
  // for a connected peer's newly-appended block to finish streaming over
  // the wire. Confirmed empirically: calling flush()+update() immediately
  // after a remote append reliably misses it, while waiting on this
  // instance's own 'update' event (already wired in _boot, fired whenever
  // autobase ingests newly-replicated data) reliably catches it. So sync()
  // uses `_settle()` below instead of a single bare `update()` call —
  // still purely event-driven (no fixed sleep).
  //
  // sync() must resolve, never reject (contract: "resolves when settled
  // or on timeout"). The work IIFE is `.catch(noop)`'d before racing it
  // against the timeout: `_settle`'s base.update() can rethrow (e.g.
  // SESSION_CLOSED under a concurrent close), and _checkIncoming's bounded
  // blobs.get rejects in the ordinary no-peer-has-the-blob-yet case — any
  // of those must not surface as a sync() rejection to the caller.
  async sync({ timeoutMs = 30000 } = {}) {
    if (this.opened === false) await this.ready()
    if (this.base === null) return
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })
    const work = (async () => {
      await this.swarm.flush()          // announced + pending connections done
      await this._settle(timeoutMs)     // ingest whatever connected peers have (event-driven; see divergence note)
      // RECEIVING FIRST, and via _receive() rather than the coalescing
      // _checkIncoming(): relaying awaits up to 30s per un-acked blob, so a
      // single blob nobody can serve — the exact offline case this method
      // exists for — used to eat the whole budget and starve the step that
      // actually delivers to this device. Each step is caught on its own so
      // one failing step can't skip the other (a bounded blobs.get rejects
      // routinely), and the whole chain is still raced against timeoutMs.
      await this._receive().catch(noop)
      await this._relayBlobs().catch(noop)
    })().catch(noop)
    await Promise.race([work, timeout])
    clearTimeout(timer)
  }

  // Ingest replicated data as it lands. Two phases:
  //
  // 1. First-update floor: swarm.flush() only guarantees sockets are open —
  //    the roster gate attaches store.replicate() to a connection strictly
  //    AFTER an async gate scan that runs past flush(), so at the moment
  //    _settle starts, a hypercore request for a peer's new data may not
  //    even be in flight yet. If we have at least one gated connection,
  //    wait for the FIRST 'update' event (proof that replication for
  //    *something* landed), bounded by min(timeoutMs, 5000) so a
  //    genuinely-quiet peer (nothing new to send) doesn't wedge sync().
  //    With zero connections nothing can arrive over the wire at all, so
  //    this phase is skipped entirely.
  // 2. Quiet window: once satisfied (or skipped), wait idleMs with no
  //    further 'update' activity (resetting on every fresh event) so a
  //    burst of trailing updates gets folded in before sync() moves on.
  async _settle(timeoutMs, idleMs = 250) {
    await this.base.update()
    if (this._connections && this._connections.size > 0) {
      await this._waitForUpdate(Math.min(timeoutMs, 5000))
    }
    await this._quietWindow(idleMs)
    await this.base.update()
  }

  // Resolve on the next 'update' event, or after ms — whichever comes
  // first. Always removes its own listener, so a peer that never sends
  // anything doesn't leak a handler past the timeout.
  _waitForUpdate(ms) {
    return new Promise((resolve) => {
      let timer
      const done = () => {
        clearTimeout(timer)
        this.off('update', onUpdate)
        resolve()
      }
      const onUpdate = () => done()
      timer = setTimeout(done, ms)
      this.on('update', onUpdate)
    })
  }

  // Resolve once idleMs has elapsed with no 'update' event (the timer is
  // reset on every fresh event).
  _quietWindow(idleMs) {
    return new Promise((resolve) => {
      const done = () => {
        this.off('update', onUpdate)
        resolve()
      }
      let timer = setTimeout(done, idleMs)
      const onUpdate = () => {
        clearTimeout(timer)
        timer = setTimeout(done, idleMs)
      }
      this.on('update', onUpdate)
    })
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
    // A connection we (or the far end) destroy — gate rejection, revocation,
    // or a genuine network drop — surfaces as an 'error' (e.g. ECONNRESET)
    // on whichever side didn't initiate it. Swallow it here: 'close' is
    // still the source of truth for connection bookkeeping below.
    conn.on('error', () => {})
    // Gate check is async; buffer nothing meanwhile — replication attaches only after the check.
    this._gate(remote).then(async (allowed) => {
      if (!allowed) return conn.destroy()
      if (conn.destroyed) return // closed during the async gate: never store a phantom
      this._connections.set(remote, conn)
      conn.on('close', () => {
        if (this._connections.get(remote) === conn) this._connections.delete(remote)
        this.emit('roster-changed')
      })
      // Replication is NOT part of the invite exemption. A remote admitted
      // only because a pairing window happens to be open keeps its socket
      // (blind-pairing rides it on its own protomux channel, independent of
      // store.replicate) but gets no access to the group's cores: blob
      // cores are unencrypted, so a leaked ref is the entire capability,
      // and a revoked ex-member still holds the view's encryption key. Such
      // a connection is upgraded the moment its key lands on the roster —
      // approve() does it directly, _enforceGate does it on roster-changed.
      // `base === null` means WE are the joiner: replicating then exposes
      // only our own (empty) cores, and the base we are about to boot needs
      // the stream already attached.
      if (this.base === null || (await this._isRostered(remote))) this._replicate(conn)
      this.emit('roster-changed')
    }, () => conn.destroy())
  }

  // Attach store.replicate to a gated connection, at most once per stream
  // (store.replicate is not idempotent — a second call on the same stream
  // would open a duplicate set of channels).
  _replicate(conn) {
    if (conn.destroyed || this._replicating.has(conn)) return
    this._replicating.add(conn)
    this.store.replicate(conn) // replicates the base AND blob cores (Task 7)
  }

  // Roster gate: may this remote hold a socket at all? Strangers are
  // destroyed unless an invite is outstanding (the pairing window
  // BlindPairing needs the wire for) or we haven't booted a base yet (still
  // pairing ourselves). NOTE this is strictly weaker than "may replicate" —
  // see _isRostered and _onConnection.
  async _gate(remoteSwarmKeyHex) {
    if (this.base === null) return true // still pairing: BlindPairing needs the wire
    if (await this._isRostered(remoteSwarmKeyHex)) return true
    const invite = await this.base.view.get(k.invite)
    // Pairing window open: allow the SOCKET only (see _onConnection — no
    // store.replicate rides this exemption), and only while unexpired.
    return invite !== null && (invite.value.expires === 0 || Date.now() <= invite.value.expires)
  }

  // Does this swarm key belong to a rostered device? The one condition that
  // earns replication, as opposed to _gate's weaker "may hold the socket".
  async _isRostered(remoteSwarmKeyHex) {
    if (this.base === null) return false
    for await (const node of this.base.view.createReadStream({ gte: 'device/', lt: 'device0' })) {
      if (node.value.swarmKey === remoteSwarmKeyHex) return true
    }
    return false
  }

  // Runs on every 'roster-changed'. Two jobs: drop connections the gate no
  // longer allows (revocation, invite expiry/burn), and upgrade the ones
  // admitted on the invite exemption alone once their key appears on the
  // roster — that post-approval upgrade is what lets pairing ride a
  // non-replicating socket in the first place.
  async _enforceGate() {
    if (this.base === null || !this._connections) return
    for (const [remote, conn] of this._connections) {
      if (!(await this._gate(remote))) {
        conn.destroy()
        continue
      }
      if (this._replicating.has(conn)) continue
      if (await this._isRostered(remote)) this._replicate(conn)
    }
  }

  _isOnline(swarmKeyHex) {
    return this._connections ? this._connections.has(swarmKeyHex) : false
  }

  async _onCandidate(candidate) {
    // Never open a new pending candidate once close() has started —
    // close() drains and settles whatever is already in `_pending`, but
    // it can't wait for candidates that haven't been added yet.
    if (this.closing) return

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
    // DEFERRED (ledgered by the controller): stale-session first-wins —
    // if a candidate reconnects/restarts with the same key while still
    // pending, this drops the newer session rather than replacing it.
    if (this._pending.has(key)) return

    // blind-pairing's Member._addRequest awaits this handler's returned
    // promise and, once it settles, checks candidate.response to decide
    // whether to send anything back at all — so this must stay pending
    // until approve()/deny() has actually called confirm()/deny() on the
    // candidate. Resolving early (e.g. right after emit()) would let
    // _addRequest see a still-empty response and drop the reply, silently
    // stranding the joiner. approve()/deny() call `settle()` once done;
    // close() also settles (with an error) any candidate still pending so
    // an undecided candidate can never wedge close() forever (this promise
    // is awaited, transitively, by Member._close()/BlindPairing._close()).
    let settle
    const decided = new Promise((resolve, reject) => {
      settle = (err) => { if (err) reject(err); else resolve() }
    })
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
      const expired = existing.value.expires !== 0 && Date.now() > existing.value.expires
      if (!expired) {
        if (this.member) await this.member.flushed()
        return z32.encode(b4a.from(existing.value.invite, 'hex'))
      }
      // Dead invite: nothing else can ever redeem it (spec §6's only
      // remedy is a fresh one), and re-serving it forever would leave the
      // creator with no working invite. Burn it and fall through to mint
      // a new one.
      await this._append(ops.delInvite())
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
    if (this._pending === null) throw new Error('not in a group')
    const pending = this._pending.get(candidateKey)
    if (!pending) throw new Error('no pending candidate with that key')
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || !self.value.isCreator) throw new Error('only the creator can approve')

    try {
      await this._append(ops.addDevice({
        key: pending.key,
        swarmKey: pending.swarmKey,
        name: pending.name
      }))
      // This candidate's connection was admitted on the invite exemption
      // alone, so it is NOT replicating yet. Upgrade it here, BEFORE handing
      // over the group keys: the joiner boots its base and waits to become
      // writable the moment confirm() lands, and it can only do that over a
      // replicating stream. The roster-changed -> _enforceGate path gets
      // there too, but only after the append shows up in the view — a race
      // this side of the wire has no reason to run.
      const conn = this._connections.get(pending.swarmKey)
      if (conn) this._replicate(conn)
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

      // Burning the invite must actually bound it: any OTHER candidate
      // still pending on this same (now-dead) invite must not remain
      // approvable afterward. Deny each (best-effort — a candidate may
      // have disconnected) and settle its awaiting _onCandidate so their
      // joinGroup() rejects via the already-wired 'rejected' path instead
      // of hanging until superseded.
      for (const other of this._pending.values()) {
        try { other.candidate.deny() } catch { /* best-effort only */ }
        other.settle()
      }
      this._pending.clear()
    } finally {
      // Always let the awaiting _onCandidate return — even if an append
      // above threw (e.g. base closing mid-approve) — so we never leave
      // it stuck forever; see the close()-wedge fix in _close().
      pending.settle()
    }
  }

  async deny(candidateKey) {
    if (this._pending === null) throw new Error('not in a group')
    const pending = this._pending.get(candidateKey)
    if (!pending) throw new Error('no pending candidate with that key')
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || !self.value.isCreator) throw new Error('only the creator can deny')

    // Investigated (Task 5): blind-pairing-core's MemberRequest exposes an
    // explicit deny() that encodes and sends a PAIRING_REJECTED response,
    // which the candidate's CandidateRequest.handleResponse() turns into a
    // 'rejected' event on candidate.request — already wired in pairer.js
    // to reject joinGroup()'s promise. So a denied joiner's joinGroup call
    // rejects instead of hanging until superseded.
    try {
      pending.candidate.deny()
      this._pending.delete(candidateKey)
      await this._append(ops.delInvite()) // burn it: deny means this invite is compromised/unwanted
    } finally {
      pending.settle()
    }
  }

  async removeDevice(key) {
    if (this.base === null) throw new Error('not in a group')
    if (key === this.deviceKey) throw new Error('cannot remove self')
    const self = await this.base.view.get(k.device(this.deviceKey))
    if (self === null || !self.value.isCreator) throw new Error('only the creator can remove devices')
    const record = await this.base.view.get(k.device(key))
    if (record === null) throw new Error('unknown device')
    await this._append(ops.removeDevice({ key }))
    const conn = this._connections.get(record.value.swarmKey)
    if (conn) conn.destroy()
  }

  async _close() {
    // Settle (with an error) every still-pending candidate before touching
    // pairing/swarm/base: an undecided candidate's _onCandidate is stuck
    // awaiting its `decided` promise, which is transitively awaited by
    // Member._close() (via _activePoll, on the DHT-lookup path) ->
    // BlindPairing._close() -> `this.pairing.close()` below — so without
    // this, close() would wedge forever on any pairing-request nobody
    // ever approved/denied.
    if (this._pending !== null) {
      for (const pending of this._pending.values()) pending.settle(new Error('closed'))
      this._pending.clear()
    }
    if (this._activeJoin !== null) {
      const stale = this._activeJoin
      this._activeJoin = null
      stale.interrupted = true // keep pending-invite: the next open resumes this join
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
