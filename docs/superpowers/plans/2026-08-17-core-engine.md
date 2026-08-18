# Core Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless P2P engine (`core/`) that implements the full WallpaperCore API — group formation, invite/approve pairing, targeted queued wallpaper delivery with acks — proven by multi-peer integration tests.

**Architecture:** An autobase multi-writer log (JSON ops, Hyperbee view) modeled on Holepunch's autopass, with hyperblobs for image bytes and blind-pairing for invites. Shells (Plans 2–3) consume only the API in the spec §3.1.

**Tech Stack:** autobase, corestore, hyperbee, hyperblobs, hyperswarm, blind-pairing, b4a, z32, compact-encoding, brittle + hyperdht/testnet + test-tmp for tests. Plain Node for development; Bare compatibility preserved via the `imports` map (`bare-fs`/`fs`).

**Spec:** `docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md`

## The Learning Loop (project workflow)

This plan is executed one task at a time, as **teachable units**:

1. A fresh subagent implements the task exactly as written (TDD steps).
2. The main thread presents the diff as a walkthrough against the task's **Learning goal**, and the human reviews it and asks questions before the next task starts.
3. Tangents/deep dives go to a **side session** (separate terminal), which must end by writing `docs/notes/<topic>.md`: ≤10-line summary plus any decision. The main thread reads only that file. Decisions that change this plan get folded into this document.
4. Each completed task gets one line in `docs/notes/JOURNAL.md` (`YYYY-MM-DD Task N: <what landed / anything surprising>`).

Each task ends with an **Understanding checkpoint** — what the human should be able to explain before moving on. The walkthrough is built around it.

## Global Constraints

- Dependency versions: pin exactly what autopass 3.4.1 pins (see Task 1 `package.json`); upgrade deliberately, never incidentally.
- The Holepunch APIs move. The cloned reference at `reference/autopass/` (gitignored) is the ground truth when this plan's code disagrees with reality; record any divergence in `docs/notes/api-divergences.md`.
- Ops are plain JSON (autobase `valueEncoding: 'json'`); all binary keys cross the op boundary as **hex strings** (convert with `b4a`). No hyperschema/hyperdispatch codegen (deliberate teachability deviation from autopass).
- The view is a Hyperbee (`keyEncoding: 'utf-8'`, `valueEncoding: 'json'`) — no HyperDB (same reason).
- `apply()` must be deterministic: no timestamps, randomness, or local state inside apply. Timestamps go into the op at append time on the sender.
- Shell-facing API = spec §3.1 exactly. One approved delta: per-target send status adds `'superseded'` (see Task 10).
- Image validation in core = magic-bytes format sniff (JPEG/PNG/WebP) + 20 MB cap. Full decode verification is the shell setter's job (it decodes to apply); a setter failure keeps the send queued via the missing ack.
- Every task: tests first, watch them fail, implement, watch them pass, commit. `npm test` (lint + brittle) must be green at every commit.
- Files stay small and single-purpose; `index.js` holds only the public class and wiring.

## File Structure

```
core/
  package.json          — deps (pinned), test scripts, Bare imports map
  index.js              — WallpaperCore (public API, wiring only)
  lib/pairer.js         — candidate-side pairing (joinGroup internals)
  lib/apply.js          — autobase apply dispatch + view key helpers
  lib/ops.js            — op constructors (the only place op shapes live)
  lib/blobs.js          — BlobStore: own hyperblobs core + remote fetch
  lib/image.js          — validateImage(buffer) → '.jpg'|'.png'|'.webp'
  lib/meta.js           — LocalMeta: non-replicated local KV (Hyperbee)
  test/helpers.js       — testnet, create/pair/eventFlush test utilities
  test/NN-*.test.js     — one file per task (see tasks)
docs/notes/             — JOURNAL.md, side-session notes, api-divergences.md
reference/autopass/     — gitignored clone, ground truth for API shapes
```

View schema (Hyperbee keys → JSON values):

| Key | Value | Written by op |
|-----|-------|---------------|
| `device/<writerKeyHex>` | `{ key, swarmKey, name, isCreator }` | `add-device` (deleted by `remove-device`) |
| `creator` | `{ key }` — set by the first add-device; roster ops from any other author are ignored in apply | `add-device` (bootstrap only) |
| `invite` | `{ id, invite, publicKey, expires }` (hex fields) | `add-invite` / `del-invite` |
| `send/<id>` | `{ id, seq, from, targets:[hex], blob:{core,id}, meta, sentAt }` | `set-wallpaper` |
| `send-seq` | `{ n }` — monotonic counter assigned in apply | `set-wallpaper` |
| `ack/<sendId>/<deviceHex>` | `{ appliedAt }` | `applied` |

---

### Task 1: Scaffold, pinned deps, test harness

**Learning goal:** The anatomy of a Holepunch project — what corestore, hyperswarm, and a local DHT testnet each are, and how brittle tests drive them.

**Files:**
- Create: `core/package.json`, `core/test/helpers.js`, `core/test/01-smoke.test.js`, `.gitignore`, `docs/notes/JOURNAL.md`

**Interfaces:**
- Produces: `helpers.js` exports `makeTestnet(t, n = 10)`, `tmpDir(t)`, `eventFlush()` — used by every later test file.

- [ ] **Step 1: Write `.gitignore` and clone the reference**

```gitignore
node_modules/
reference/
core/test/sandbox/
```

```bash
git clone --depth 1 https://github.com/holepunchto/autopass.git reference/autopass
```

- [ ] **Step 2: Write `core/package.json`** (versions copied from `reference/autopass/package.json`; add hyperblobs + hypercore-crypto, drop the hyperdb/hyperschema codegen stack)

```json
{
  "name": "pear-wallpaper-core",
  "version": "0.1.0",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "brittle": "brittle test/*.test.js",
    "test": "npm run brittle"
  },
  "imports": {
    "fs": { "bare": "bare-fs", "default": "fs" },
    "path": { "bare": "bare-path", "default": "path" }
  },
  "dependencies": {
    "autobase": "^7.19.4",
    "b4a": "^1.7.1",
    "blind-pairing": "^2.3.1",
    "compact-encoding": "^2.16.0",
    "corestore": "^7.4.7",
    "hyperbee": "^2.26.5",
    "hyperblobs": "^2.8.0",
    "hypercore-crypto": "^3.6.1",
    "hyperswarm": "^4.14.0",
    "ready-resource": "^1.2.0",
    "z32": "^1.1.0"
  },
  "devDependencies": {
    "bare-fs": "^4.4.4",
    "bare-path": "^3.0.0",
    "brittle": "^3.19.0",
    "hyperdht": "^6.23.0",
    "test-tmp": "^1.4.0"
  }
}
```

Run: `cd core && npm install`. If any version fails to resolve, take the nearest compatible release and log it in `docs/notes/api-divergences.md`.

- [ ] **Step 3: Write `core/test/helpers.js`**

```js
const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')

async function makeTestnet(t, n = 10) {
  return createTestnet(n, t)
}

function tmpDir(t) {
  return tmp(t)
}

// Wait until an (optionally async) predicate holds, re-checking on every
// emitter event (autopass's updateUntil pattern, async-capable). A 10s
// safety timeout turns a silent hang into a loud test failure.
async function until(emitter, event, fn, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (await fn()) return
    if (Date.now() > deadline) throw new Error(`until(${event}): timed out`)
    await new Promise((resolve) => {
      const timer = setTimeout(done, 250) // also poll: events can fire before we listen
      emitter.once(event, done)
      function done() {
        clearTimeout(timer)
        emitter.off(event, done)
        resolve()
      }
    })
  }
}

// Let pending promises/io settle
function eventFlush() {
  return new Promise((resolve) => setImmediate(resolve))
}

module.exports = { makeTestnet, tmpDir, until, eventFlush }
```

- [ ] **Step 4: Write the failing smoke test `core/test/01-smoke.test.js`**

```js
const test = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')
const { makeTestnet, tmpDir } = require('./helpers')

test('two swarms exchange a hypercore block over a local testnet', async function (t) {
  const tn = await makeTestnet(t)

  const storeA = new Corestore(await tmpDir(t))
  const storeB = new Corestore(await tmpDir(t))

  const coreA = storeA.get({ name: 'demo' })
  await coreA.ready()
  await coreA.append(b4a.from('hello p2p'))

  const swarmA = new Hyperswarm({ bootstrap: tn.bootstrap })
  const swarmB = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await swarmA.destroy()
    await swarmB.destroy()
    await storeA.close()
    await storeB.close()
  })

  swarmA.on('connection', (conn) => storeA.replicate(conn))
  swarmB.on('connection', (conn) => storeB.replicate(conn))

  const discovery = swarmA.join(coreA.discoveryKey)
  await discovery.flushed() // A's announce must reach the DHT before B looks up
  swarmB.join(coreA.discoveryKey)

  const coreB = storeB.get(coreA.key) // capability: knowing the key IS the read grant
  await coreB.ready()
  const block = await coreB.get(0)
  t.is(b4a.toString(block), 'hello p2p')
})
```

- [ ] **Step 5: Run it, expect failure first, then pass**

Run: `cd core && npm test` — first without `npm install` completed it fails (module not found); after install it must PASS. If it hangs, the swarm teardown order is wrong — destroy swarms before stores.

- [ ] **Step 6: Create `docs/notes/JOURNAL.md`** with a first line, and commit

```markdown
# Journal
- 2026-08-17 Task 1: scaffold + smoke test green (corestore/hyperswarm/testnet working)
```

```bash
git add -A && git commit -m "feat(core): scaffold, pinned deps, testnet smoke test"
```

**Understanding checkpoint:** You can explain what a hypercore is, why knowing a core's key grants read access (capability model), what the DHT testnet replaces, and what `store.replicate(connection)` does.

---

### Task 2: WallpaperCore lifecycle & identity

**Learning goal:** The ReadyResource open/close pattern, corestore namespaces, and where a device's identity keypair actually lives.

**Files:**
- Create: `core/index.js`, `core/lib/meta.js`
- Test: `core/test/02-lifecycle.test.js`

**Interfaces:**
- Produces: `new WallpaperCore({ storageDir, deviceName, bootstrap })` (bootstrap is test-only DHT override), `await core.ready()`, `await core.close()`, `core.deviceKey: string(hex64)`, `core.groupStatus: 'none'|'joining'|'member'`, `core.deviceName`.
- Produces (internal): `core.store` (Corestore), `core.meta` (LocalMeta) with `await get(key)` / `await put(key, value)` / `await del(key)`.

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const WallpaperCore = require('../index.js')
const { tmpDir } = require('./helpers')

test('lifecycle: identity is stable across reopen', async function (t) {
  const dir = await tmpDir(t)

  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'test-mac' })
  await core1.ready()
  const key1 = core1.deviceKey
  t.is(typeof key1, 'string')
  t.is(key1.length, 64)
  t.is(core1.groupStatus, 'none')
  t.is(core1.deviceName, 'test-mac')
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'test-mac' })
  await core2.ready()
  t.is(core2.deviceKey, key1, 'same storage, same identity')
  await core2.close()
})

test('lifecycle: local meta persists', async function (t) {
  const dir = await tmpDir(t)
  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'x' })
  await core1.ready()
  await core1.meta.put('probe', { hello: 1 })
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'x' })
  await core2.ready()
  t.alike(await core2.meta.get('probe'), { hello: 1 })
  t.is(await core2.meta.get('missing'), null)
  await core2.close()
})
```

- [ ] **Step 2: Run to verify failure** — `cd core && npx brittle test/02-lifecycle.test.js` → FAIL (cannot find `../index.js`).

- [ ] **Step 3: Write `core/lib/meta.js`**

```js
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
```

- [ ] **Step 4: Write `core/index.js` (lifecycle only)**

```js
const Corestore = require('corestore')
const Autobase = require('autobase')
const ReadyResource = require('ready-resource')
const b4a = require('b4a')
const LocalMeta = require('./lib/meta.js')

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
  }

  async _close() {
    if (this.swarm !== null) await this.swarm.destroy()
    if (this.base !== null) await this.base.close()
    await this.meta.close()
    await this.store.close()
  }
}

module.exports = WallpaperCore
```

- [ ] **Step 5: Run tests to verify pass** — `npx brittle test/02-lifecycle.test.js` → PASS. If `Autobase.getLocalCore` is not a function in the pinned version, check `reference/autopass/index.js:60` for the current name and log the divergence.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): WallpaperCore lifecycle, identity, local meta"
```

**Understanding checkpoint:** You can explain why `deviceKey` is the autobase local-writer key (one identity for roster, sends, and acks), what ReadyResource's `_open`/`_close` contract is, and why `local-meta` never leaves the device (named core, never announced or handed out — and even its key is never shared).

---

### Task 3: createGroup, the autobase log, and the roster view

**Learning goal:** The heart of the whole app — how an append-only multi-writer log plus a deterministic `apply` function materializes shared state (the roster) identically on every device.

**Files:**
- Create: `core/lib/ops.js`, `core/lib/apply.js`
- Modify: `core/index.js`
- Test: `core/test/03-group.test.js`

**Interfaces:**
- Consumes: Task 2 lifecycle.
- Produces: `await core.createGroup()`, `await core.listDevices() → [{ key, name, isSelf, isCreator, online }]`, `'roster-changed'` event. Internal: `core._boot({ key, encryptionKey })`, `core._append(op)`, ops module (`ops.addDevice(...)` etc.), meta keys `group` (`{ key, encryptionKey }` hex) used on reopen.

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const WallpaperCore = require('../index.js')
const { tmpDir, until } = require('./helpers')

test('createGroup: creator appears in its own roster', async function (t) {
  const core = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'alpha' })
  await core.ready()
  t.teardown(() => core.close())

  await core.createGroup()
  t.is(core.groupStatus, 'member')

  const devices = await core.listDevices()
  t.is(devices.length, 1)
  t.is(devices[0].key, core.deviceKey)
  t.is(devices[0].name, 'alpha')
  t.is(devices[0].isSelf, true)
  t.is(devices[0].isCreator, true)
})

test('createGroup: group survives reopen', async function (t) {
  const dir = await tmpDir(t)
  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'alpha' })
  await core1.ready()
  await core1.createGroup()
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'alpha' })
  await core2.ready()
  t.is(core2.groupStatus, 'member', 'reopen restores membership')
  const devices = await core2.listDevices()
  t.is(devices.length, 1)
  t.is(devices[0].name, 'alpha')
  t.is(devices[0].key, core2.deviceKey, 'roster key IS the reopened local-writer key')
  await core2.close()
})

test('createGroup: cannot create twice', async function (t) {
  const core = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'alpha' })
  await core.ready()
  t.teardown(() => core.close())
  await core.createGroup()
  await t.exception(() => core.createGroup(), /already/)
})
```

- [ ] **Step 2: Run to verify failure** — FAIL: `createGroup is not a function`.

- [ ] **Step 3: Write `core/lib/ops.js`** — every op shape in one place

```js
// Ops are plain JSON. Binary keys travel as hex strings.
// `apply` must stay deterministic, so anything time- or random-based
// (sentAt, send ids) is stamped HERE, at append time on the writer.
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

module.exports = {
  addDevice({ key, swarmKey, name }) {
    return { type: 'add-device', key, swarmKey, name } // isCreator is DERIVED in apply, never carried in the op
  },
  removeDevice({ key }) {
    return { type: 'remove-device', key }
  },
  addInvite({ id, invite, publicKey, expires }) {
    return { type: 'add-invite', id, invite, publicKey, expires }
  },
  delInvite() {
    return { type: 'del-invite' }
  },
  setWallpaper({ from, targets, blob, meta }) {
    return {
      type: 'set-wallpaper',
      id: b4a.toString(crypto.randomBytes(16), 'hex'),
      from,
      targets,
      blob, // { core: hex, id: hyperblobs id object }
      meta, // { filename, byteLength }
      sentAt: Date.now()
    }
  },
  applied({ sendId, device }) {
    return { type: 'applied', sendId, device, appliedAt: Date.now() }
  }
}
```

- [ ] **Step 4: Write `core/lib/apply.js`**

```js
const b4a = require('b4a')

// View keys. One module owns the key layout so scans stay consistent.
const k = {
  device: (hex) => `device/${hex}`,
  creator: 'creator',
  invite: 'invite',
  send: (id) => `send/${id}`,
  sendSeq: 'send-seq',
  ack: (sendId, deviceHex) => `ack/${sendId}/${deviceHex}`
}

// The apply function: consumes ordered log nodes, mutates the view.
// MUST be deterministic — every member runs this over the same op
// sequence and must land on byte-identical views.
//
// ROSTER POLICY (creator-only, enforced HERE): apply is the group's
// constitution — a compromised member can append any op it likes, but
// every honest peer's apply ignores roster ops not authored by the
// creator. The first add-device ever applied (createGroup's self-add)
// establishes the creator. `node.from.key` is the authoring writer's
// core key in autobase 7.x; if the pinned version names it differently,
// check the autobase source and log the divergence.
async function apply(nodes, view, base) {
  for (const node of nodes) {
    const op = node.value
    const author = b4a.toString(node.from.key, 'hex')
    switch (op.type) {
      case 'add-device': {
        const creator = await view.get(k.creator)
        if (creator === null) {
          // bootstrap: the very first add-device defines the creator —
          // bound to the VERIFIED author, never the op's claimed key
          if (op.key !== author) break
          await view.put(k.creator, { key: author })
        } else if (author !== creator.value.key) {
          break // forged roster op from a non-creator: ignored by every honest peer
        }
        const creatorKey = creator === null ? author : creator.value.key
        await view.put(k.device(op.key), {
          key: op.key,
          swarmKey: op.swarmKey,
          name: op.name,
          isCreator: op.key === creatorKey // derived, never self-reported
        })
        await base.addWriter(b4a.from(op.key, 'hex'))
        break
      }
      case 'remove-device': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only
        if (op.key === creator.value.key) break // the creator cannot be removed
        await view.del(k.device(op.key))
        await base.removeWriter(b4a.from(op.key, 'hex'))
        break
      }
      case 'add-invite': {
        await view.put(k.invite, {
          id: op.id, invite: op.invite, publicKey: op.publicKey, expires: op.expires
        })
        break
      }
      case 'del-invite': {
        await view.del(k.invite)
        break
      }
      case 'set-wallpaper': {
        const seqNode = await view.get(k.sendSeq)
        const seq = seqNode === null ? 1 : seqNode.value.n + 1
        await view.put(k.sendSeq, { n: seq })
        await view.put(k.send(op.id), {
          id: op.id, seq, from: op.from, targets: op.targets,
          blob: op.blob, meta: op.meta, sentAt: op.sentAt
        })
        break
      }
      case 'applied': {
        await view.put(k.ack(op.sendId, op.device), { appliedAt: op.appliedAt })
        break
      }
      // Unknown op types are skipped, not fatal: an older device must
      // survive ops appended by a newer one.
    }
  }
}

module.exports = { apply, k }
```

- [ ] **Step 5: Add group bootstrap to `core/index.js`**

Add requires: `Hyperbee`, `Hyperswarm`, `{ apply, k }` from `./lib/apply.js`, `ops` from `./lib/ops.js`.

```js
  // inside class WallpaperCore

  _boot({ key = null, encryptionKey = null } = {}) {
    this.base = new Autobase(this.store, key ? b4a.from(key, 'hex') : null, {
      encrypt: true,
      encryptionKey: encryptionKey ? b4a.from(encryptionKey, 'hex') : undefined,
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
      name: this.deviceName
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
```

And in `_open()`, after the deviceKey block, restore a persisted group:

```js
    const group = await this.meta.get('group')
    if (group !== null) {
      this._boot(group)
      await this.base.ready()
      await this._startSwarm()
    }
```

In `_close()`, the existing order (swarm → base → meta → store) already covers the new members.

- [ ] **Step 6: Run tests to verify pass** — `npx brittle test/03-group.test.js` → PASS. Autobase option-name drift (`encrypt`/`encryptionKey`/`open`/`apply`) is the likely failure; compare `reference/autopass/index.js:196-217`.

- [ ] **Step 7: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): createGroup, autobase log, roster view"
```

**Understanding checkpoint:** You can explain the log→apply→view pipeline, why `apply` must be deterministic (every device replays the same ops and must agree), why `addWriter` happens *inside* apply, and how reopen works (meta-stored group key + encryptionKey re-boot the same autobase).

---

### Task 4: Invites and the candidate side of pairing

**Learning goal:** How blind-pairing works — an invite as a one-time capability, the rendezvous on the group's discovery key, and why the candidate learns nothing until confirmed.

**Files:**
- Create: `core/lib/pairer.js`
- Modify: `core/index.js` (`_startSwarm`, `createInvite`, `joinGroup`, `'pairing-request'`)
- Modify: `core/lib/apply.js` (creator-only guards on invite ops — ruled during design review)
- Test: `core/test/04-pairing.test.js`

**Interfaces:**
- Consumes: Task 3 (`_boot`, `_append`, ops, view keys).
- Produces: `await core.createInvite() → string(z32)`, `await core.joinGroup(invite)` (resolves in Task 5), `'pairing-request'` event `{ candidateKey, name }`, internal `core._pending: Map<candidateKeyHex, candidate>`, meta key `pending-invite` for restart resume. Candidate `userData` JSON: `{ key, swarmKey, name }` (all hex/string) — Task 5 and 6 rely on all three fields.

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir } = require('./helpers')

test('pairing: candidate request reaches the creator', async function (t) {
  t.plan(4)
  const tn = await makeTestnet(t)

  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const invite = await creator.createInvite()
  t.is(typeof invite, 'string')

  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())

  creator.on('pairing-request', ({ candidateKey, name }) => {
    t.is(candidateKey, joiner.deviceKey)
    t.is(name, 'phone')
  })

  joiner.joinGroup(invite).catch(() => {}) // resolves only after Task 5's approve
  t.is(joiner.groupStatus, 'joining')
})

test('pairing: createInvite is idempotent until consumed', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const a = await creator.createInvite()
  const b = await creator.createInvite()
  t.is(a, b, 'outstanding invite is reused, not multiplied')
})
```

- [ ] **Step 2: Run to verify failure** — FAIL: `createInvite is not a function`.

- [ ] **Step 3a: Extend the creator-only policy to invite ops in `core/lib/apply.js`** — a forged invite record is a social-engineering path (an attacker-planted invite makes a routine-looking pairing request). Guard both cases:

```js
      case 'add-invite': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only, like all authority ops
        await view.put(k.invite, {
          id: op.id, invite: op.invite, publicKey: op.publicKey, expires: op.expires
        })
        break
      }
      case 'del-invite': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only
        await view.del(k.invite)
        break
      }
```

- [ ] **Step 3: Implement `_startSwarm` + `createInvite` in `index.js`** (member side; modeled on `reference/autopass/index.js:331-373`, with the human gate replacing auto-admit)

```js
const BlindPairing = require('blind-pairing')
const z32 = require('z32')
const c = require('compact-encoding')
```

```js
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
    const inv = await this.base.view.get(k.invite)
    if (inv === null || inv.value.id !== b4a.toString(candidate.inviteId, 'hex')) return
    candidate.open(b4a.from(inv.value.publicKey, 'hex'))
    const { key, swarmKey, name } = JSON.parse(b4a.toString(candidate.userData))
    this._pending.set(key, { candidate, key, swarmKey, name })
    this.emit('pairing-request', { candidateKey: key, name })
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
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)
    await this._append(ops.addInvite({
      id: b4a.toString(id, 'hex'),
      invite: b4a.toString(invite, 'hex'),
      publicKey: b4a.toString(publicKey, 'hex'),
      expires
    }))
    if (this.member) await this.member.flushed()
    return z32.encode(invite)
  }
```

- [ ] **Step 4: Write `core/lib/pairer.js`** (candidate side; modeled on `reference/autopass/index.js:22-141`, adapted to boot the group *inside* the same WallpaperCore)

```js
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const Autobase = require('autobase')
const z32 = require('z32')
const b4a = require('b4a')

// Runs the candidate side of blind-pairing on behalf of a WallpaperCore.
// Resolves { key, encryptionKey } (hex) once a member confirms us.
async function requestJoin(core, inviteZ32) {
  await core._startPairingSwarm() // swarm without a base yet (defined below in index.js)

  const local = Autobase.getLocalCore(core.store)
  await local.ready()
  const key = b4a.toString(local.key, 'hex')
  await local.close()

  const userData = b4a.from(JSON.stringify({
    key,
    swarmKey: await core._swarmKeyHex(),
    name: core.deviceName
  }))

  return new Promise((resolve, reject) => {
    const candidate = core.pairing.addCandidate({
      invite: z32.decode(inviteZ32),
      userData,
      onadd: (result) => {
        resolve({
          key: b4a.toString(result.key, 'hex'),
          encryptionKey: b4a.toString(result.encryptionKey, 'hex'),
          candidate
        })
      }
    })
  })
}

module.exports = { requestJoin }
```

- [ ] **Step 5: Implement `joinGroup` + `_startPairingSwarm` in `index.js`**

```js
const { requestJoin } = require('./lib/pairer.js')
```

```js
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
    this._joining = true
    await this.meta.put('pending-invite', { invite }) // restart resume
    try {
      const result = await requestJoin(this, invite)
      this._boot(result)
      await this.base.ready()
      // become a full member: wait until our writer was added
      await new Promise((resolve) => {
        if (this.base.writable) return resolve()
        const check = () => {
          if (!this.base.writable) return
          this.base.off('update', check)
          resolve()
        }
        this.base.on('update', check)
      })
      this.member = this.pairing.addMember({
        discoveryKey: this.base.discoveryKey,
        onadd: (candidate) => this._onCandidate(candidate)
      })
      this._pending = new Map()
      this.swarm.join(this.base.discoveryKey)
      await this.meta.put('group', {
        key: b4a.toString(this.base.key, 'hex'),
        encryptionKey: b4a.toString(this.base.encryptionKey, 'hex')
      })
      await this.meta.del('pending-invite')
      await result.candidate.close().catch(() => {})
    } finally {
      this._joining = false
    }
  }
```

And in `_open()`, after the group-restore block, resume an interrupted join:

```js
    if (this.base === null) {
      const pending = await this.meta.get('pending-invite')
      if (pending !== null) this.joinGroup(pending.invite).catch(() => this.emit('error-joining'))
    }
```

- [ ] **Step 6: Run tests, expect pass; keep earlier suites green** — `npx brittle test/*.test.js`. Flaky-hang suspects: `member.flushed()` naming and candidate/`userData` shapes — verify against `reference/autopass/index.js:65-93,344-363`.

- [ ] **Step 7: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): invites and candidate-side pairing with explicit approval gate"
```

**Understanding checkpoint:** You can explain what's inside an invite (secret + the base key it unlocks), what the candidate reveals before approval (only its userData — key, swarmKey, name), why this deviates from autopass's auto-admit, and how a restart mid-join resumes.

---

### Task 5: approve / deny — completing the pairing handshake

**Learning goal:** Consensus membership — what actually makes a device a member (its writer key entering the log via `add-device` → `addWriter` in apply), and how the joiner's promise resolution is driven by *replicated state*, not a direct message.

**Files:**
- Modify: `core/index.js`
- Test: `core/test/05-approve.test.js`

**Interfaces:**
- Consumes: Task 4 (`_pending`, `_onCandidate`, `joinGroup`).
- Produces: `await core.approve(candidateKey)`, `await core.deny(candidateKey)`; `joinGroup` now resolves end-to-end; roster syncs to both sides.

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until } = require('./helpers')

async function createPair(t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())
  return { creator, joiner, tn }
}

test('approve: joiner becomes a member and both see the full roster', async function (t) {
  const { creator, joiner } = await createPair(t)

  const invite = await creator.createInvite()
  creator.on('pairing-request', ({ candidateKey }) => creator.approve(candidateKey))

  await joiner.joinGroup(invite)
  t.is(joiner.groupStatus, 'member')

  await until(creator, 'update', async () => (await creator.listDevices()).length === 2)
  const creatorSees = await creator.listDevices()
  const joinerSees = await joiner.listDevices()
  t.is(creatorSees.length, 2)
  t.is(joinerSees.length, 2)
  const names = joinerSees.map((d) => d.name).sort()
  t.alike(names, ['creator', 'phone'])
  t.is(joinerSees.find((d) => d.isSelf).name, 'phone')
})

test('deny: candidate is dropped and the invite is dead', async function (t) {
  const { creator, joiner } = await createPair(t)
  const invite = await creator.createInvite()

  creator.on('pairing-request', async ({ candidateKey }) => {
    await creator.deny(candidateKey)
    t.is(creator._pending.size, 0)
    const inv = await creator.base.view.get('invite')
    t.is(inv, null, 'deny burns the invite')
    t.pass('denied without throwing')
  })

  joinGroupNeverResolves(t, joiner, invite)
})

function joinGroupNeverResolves(t, joiner, invite) {
  joiner.joinGroup(invite).then(
    () => t.fail('join must not resolve after deny'),
    () => {} // rejection on close is fine
  )
}
```

Use `t.plan(3)` on the deny test so it ends after the three assertions inside the handler.

- [ ] **Step 2: Run to verify failure** — FAIL: `approve is not a function`.

- [ ] **Step 3: Implement approve/deny in `index.js`**

```js
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
    const inv = await this.base.view.get(k.invite)
    pending.candidate.confirm({
      key: this.base.key,
      encryptionKey: this.base.encryptionKey,
      additional: inv && inv.value.additional ? b4a.from(inv.value.additional, 'hex') : null
    })
    this._pending.delete(candidateKey)
    await this._append(ops.delInvite()) // single-use: an invite admits one device
  }

  async deny(candidateKey) {
    const pending = this._pending.get(candidateKey)
    if (!pending) throw new Error('no pending candidate with that key')
    this._pending.delete(candidateKey)
    await this._append(ops.delInvite()) // burn it: deny means this invite is compromised/unwanted
  }
```

(If `BlindPairing.createInvite` in the pinned version returns an `additional` field, thread it through `ops.addInvite`/apply the same way as the other fields; check `reference/autopass/index.js:271-282`.)

- [ ] **Step 4: Run tests to verify pass** — `npx brittle test/05-approve.test.js`, then the full suite. The approve test exercises the entire Task 3–5 machine; if `joinGroup` hangs, instrument `base.writable` and confirm `addWriter` fires inside apply on the creator.

- [ ] **Step 5: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): approve/deny completes pairing; rosters converge"
```

**Understanding checkpoint:** You can trace the full pairing sequence (invite → candidate userData → pairing-request → approve → add-device op → addWriter in apply → confirm → joiner boots base → writable → member) and explain why deny burns the invite.

---

### Task 6: Connection gating and revocation

**Learning goal:** Where each security layer actually bites: transport encryption (Noise), capability (core keys), encryption-at-rest (autobase encryptionKey), and our roster gate on top — plus what revocation can and cannot do.

**Files:**
- Modify: `core/index.js` (`_onConnection` gate, `removeDevice`)
- Test: `core/test/06-gating.test.js`

**Interfaces:**
- Consumes: roster with `swarmKey` (Task 4/5), `_connections`.
- Produces: `await core.removeDevice(key)`; gate: rostered swarm keys replicate; unknown keys are destroyed unless an invite is outstanding (pairing window).

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const Hyperswarm = require('hyperswarm')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until, eventFlush } = require('./helpers')

async function pairedDuo(t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const joiner = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner.ready()
  t.teardown(() => joiner.close())
  const invite = await creator.createInvite()
  creator.on('pairing-request', ({ candidateKey }) => creator.approve(candidateKey))
  await joiner.joinGroup(invite)
  return { creator, joiner, tn }
}

test('gate: a stranger on the topic gets its connection destroyed', async function (t) {
  t.plan(1)
  const { creator, tn } = await pairedDuo(t)

  const stranger = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(() => stranger.destroy())
  stranger.on('connection', (conn) => {
    conn.on('close', () => t.pass('creator dropped the stranger'))
  })
  stranger.join(creator.base.discoveryKey)
  // no invite outstanding (consumed by pairing) → gate closed
})

test('revocation: removed device loses connectivity and leaves the roster', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  await creator.removeDevice(joiner.deviceKey)
  await until(creator, 'update', async () => (await creator.listDevices()).length === 1)

  const roster = await creator.listDevices()
  t.is(roster.length, 1)
  t.is(roster[0].name, 'creator')

  await eventFlush()
  t.is(creator._connections.has(await joiner._swarmKeyHex()), false, 'connection torn down')
})

test('policy: a forged roster op from a non-creator is ignored by apply', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  await t.exception(() => joiner.removeDevice(creator.deviceKey), /only the creator/)

  // Bypass the method entirely — append the raw op, as a compromised
  // device would. Every honest peer's apply must ignore it.
  const ops = require('../lib/ops.js')
  await joiner._append(ops.removeDevice({ key: creator.deviceKey }))

  await until(creator, 'update', async () =>
    (await creator.base.view.get(`device/${joiner.deviceKey}`)) !== null
  )
  t.is((await creator.listDevices()).length, 2, 'creator still rostered on creator side')
  t.is((await joiner.listDevices()).length, 2, 'forged op ignored even on the forger')

  // Forged invite ops are equally inert (creator-only, ruled in design review)
  const BlindPairing = require('blind-pairing')
  const b4a = require('b4a')
  const forged = BlindPairing.createInvite(joiner.base.key)
  await joiner._append(ops.addInvite({
    id: b4a.toString(forged.id, 'hex'),
    invite: b4a.toString(forged.invite, 'hex'),
    publicKey: b4a.toString(forged.publicKey, 'hex'),
    expires: forged.expires
  }))
  // Assert on the forger's own view: apply is deterministic and identical on
  // every peer, so the op being ignored locally proves it is ignored everywhere.
  t.is(await joiner.base.view.get('invite'), null, 'forged invite never lands in the view')
})
```

- [ ] **Step 2: Run to verify failure** — the stranger test fails (connection stays open) and `removeDevice` is not a function.

- [ ] **Step 3: Implement the gate and `removeDevice` in `index.js`** — replace `_onConnection`:

```js
  _onConnection(conn) {
    const remote = b4a.toString(conn.remotePublicKey, 'hex')
    // Gate check is async; buffer nothing meanwhile — replication attaches only after the check.
    this._gate(remote).then((allowed) => {
      if (!allowed) return conn.destroy()
      if (conn.destroyed) return // closed during the async gate: never store a phantom
      this._connections.set(remote, conn)
      conn.on('close', () => {
        if (this._connections.get(remote) === conn) this._connections.delete(remote)
        this.emit('roster-changed')
      })
      this.store.replicate(conn)
      this.emit('roster-changed')
    }, () => conn.destroy())
  }

  async _gate(remoteSwarmKeyHex) {
    if (this.base === null) return true // still pairing: BlindPairing needs the wire
    for await (const node of this.base.view.createReadStream({ gte: 'device/', lt: 'device0' })) {
      if (node.value.swarmKey === remoteSwarmKeyHex) return true
    }
    const invite = await this.base.view.get(k.invite)
    // Pairing window open: allow. NOTE the real exposure — an invite-window
    // connection gets full store.replicate; the window must therefore be
    // bounded by expiry or an abandoned invite silently reverses revocation.
    return invite !== null && (invite.value.expires === 0 || Date.now() <= invite.value.expires)
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
```

(The method check gives non-creators a clear error; the *binding* enforcement is apply's authorship check — the method is UX, apply is law.)

Also re-run the gate when the roster changes (a device removed while connected must be cut): in `_boot()` after the update listener, add:

```js
    this.on('roster-changed', () => this._enforceGate().catch(() => {}))
```

```js
  async _enforceGate() {
    if (this.base === null || !this._connections) return
    for (const [remote, conn] of this._connections) {
      if (!(await this._gate(remote))) conn.destroy()
    }
  }
```

- [ ] **Step 4: Run the full suite** — the Task 4/5 pairing tests must STILL pass (the gate must not break the pairing window). If pairing now hangs, the invite row was deleted before the candidate finished — confirm approve() order: `add-device` op **before** `del-invite`.

- [ ] **Step 5: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): roster-gated connections and device revocation"
```

**Understanding checkpoint:** You can name the four security layers and what each one alone would/wouldn't stop, explain why the gate must stay open during an active invite, and state honestly what `removeDevice` does not undo (data the device already holds).

---

### Task 7: BlobStore — image bytes over hyperblobs

**Learning goal:** Why big binary payloads don't belong in the log: the log carries a tiny reference; the bytes live in a per-device hyperblobs core fetched on demand via the capability model.

**Files:**
- Create: `core/lib/blobs.js`
- Modify: `core/index.js` (instantiate in `_boot`)
- Test: `core/test/07-blobs.test.js`

**Interfaces:**
- Consumes: `core.store`, gated connections (Task 6).
- Produces: `core.blobs.put(buffer) → { core: hex, id }`, `core.blobs.get({ core, id }) → buffer` (works for local AND remote refs; downloads on demand).

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until } = require('./helpers')

// pairedDuo identical to test/06 — move it into helpers.js as `pairedDuo(t)` now and
// update test/06 to import it.

const { pairedDuo } = require('./helpers')

test('blobs: bytes written on one device are fetchable on another by ref only', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const payload = b4a.alloc(1024 * 1024, 0xab) // 1 MiB
  const ref = await creator.blobs.put(payload)
  t.is(typeof ref.core, 'string')

  const fetched = await joiner.blobs.get(ref)
  t.is(fetched.byteLength, payload.byteLength)
  t.ok(b4a.equals(fetched, payload))
})
```

- [ ] **Step 2: Run to verify failure** — FAIL: `blobs` undefined.

- [ ] **Step 3: Write `core/lib/blobs.js`**

```js
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
```

- [ ] **Step 4: Wire into `index.js`** — in `_boot()` add `this.blobs = new BlobStore(this.store)`, and at the end of `createGroup()` / inside `joinGroup()` after boot (and in the `_open()` restore path) call `await this.blobs.ready()`. Simplest: call it from `_startSwarm()`-adjacent code once `base` exists; keep it in one place.

- [ ] **Step 5: Run tests to verify pass** — `npx brittle test/07-blobs.test.js`. If the remote `get` hangs: the fetch rides on `store.replicate(conn)` from Task 6 — confirm both sides hold a gated, replicated connection first (`creator._connections.size > 0`).

- [ ] **Step 6: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): per-device hyperblobs store with remote fetch"
```

**Understanding checkpoint:** You can explain why the blob core's key inside a `blobRef` is itself the read capability, why this stays private (refs only travel inside the encrypted log), and why blobs are per-device single-writer.

---

### Task 8: Image validation and sendWallpaper

**Learning goal:** The full write path of the product's central verb — validate, store bytes, append the op — and why it resolves without waiting for any target (queued-delivery semantics).

**Files:**
- Create: `core/lib/image.js`
- Modify: `core/index.js` (`sendWallpaper`, `listSends` first cut)
- Test: `core/test/08-send.test.js`

**Interfaces:**
- Consumes: BlobStore (Task 7), ops (Task 3).
- Produces: `validateImage(buffer) → '.jpg'|'.png'|'.webp'` (throws on unknown/oversize), `await core.sendWallpaper(image, targets) → { id }` (image: Buffer or path string), `await core.listSends({ limit }) → [{ id, meta, sentAt, targets: [{ key, status }] }]` with status `'pending'` only for now.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('brittle')
const b4a = require('b4a')
const { validateImage } = require('../lib/image.js')
const WallpaperCore = require('../index.js')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('validateImage: sniffs formats, rejects junk and oversize', function (t) {
  t.is(validateImage(fakePng()), '.png')
  const jpg = b4a.alloc(64); jpg.set([0xff, 0xd8, 0xff], 0)
  t.is(validateImage(jpg), '.jpg')
  const webp = b4a.alloc(64)
  webp.set(b4a.from('RIFF'), 0); webp.set(b4a.from('WEBP'), 8)
  t.is(validateImage(webp), '.webp')
  t.exception(() => validateImage(b4a.from('not an image')), /unsupported/)
  t.exception(() => validateImage(fakePng(21 * 1024 * 1024)), /20 MB/)
})

test('sendWallpaper: op lands in both views, status pending', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  t.is(typeof id, 'string')

  const sends = await creator.listSends()
  t.is(sends.length, 1)
  t.is(sends[0].targets.length, 1)
  t.is(sends[0].targets[0].key, joiner.deviceKey)
  t.is(sends[0].targets[0].status, 'pending')

  await until(joiner, 'update', async () => (await joiner.base.view.get(`send/${id}`)) !== null)
  t.pass('op replicated to the target')
})

test('sendWallpaper: rejects unknown targets', async function (t) {
  const { creator } = await pairedDuo(t)
  await t.exception(
    () => creator.sendWallpaper(fakePng(), ['ab'.repeat(32)]),
    /not in the roster/
  )
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `core/lib/image.js`**

```js
const b4a = require('b4a')

const MAX_BYTES = 20 * 1024 * 1024

// Format sniff + size cap only. Full decode verification is the OS
// setter's job (spec §6): a setter failure keeps the send queued.
function validateImage(buffer) {
  if (buffer.byteLength > MAX_BYTES) throw new Error('image exceeds 20 MB cap')
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.byteLength >= 8 && b4a.equals(buffer.subarray(0, 8), b4a.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer.byteLength >= 12 && b4a.toString(buffer.subarray(0, 4)) === 'RIFF' && b4a.toString(buffer.subarray(8, 12)) === 'WEBP') return '.webp'
  throw new Error('unsupported image format (JPEG, PNG, WebP only)')
}

module.exports = { validateImage, MAX_BYTES }
```

- [ ] **Step 4: Implement `sendWallpaper` + `listSends` in `index.js`**

```js
const fs = require('fs')
const { validateImage } = require('./lib/image.js')
```

```js
  async sendWallpaper(image, targets) {
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
      meta: { ext, byteLength: buffer.byteLength, filename: typeof image === 'string' ? image : null }
    })
    await this._append(op)
    return { id: op.id }
  }

  async listSends({ limit = 20 } = {}) {
    if (this.base === null) return []
    const sends = []
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
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

  async _targetStatus(send, targetKey) {
    const ack = await this.base.view.get(k.ack(send.id, targetKey))
    return ack !== null ? 'delivered' : 'pending' // 'superseded' added in Task 10
  }
```

- [ ] **Step 5: Run the full suite to verify pass.**

- [ ] **Step 6: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): sendWallpaper with validation; listSends pending status"
```

**Understanding checkpoint:** You can walk the send path (validate → blob put → op append → return) and explain why the promise resolving proves nothing about delivery — and why that's the designed behavior.

---

### Task 9: The receive pipeline

**Learning goal:** Turning replicated state into a local side effect exactly once: detecting "newest unapplied send targeting me," fetching bytes, and handing the shell a finished file.

**Files:**
- Modify: `core/index.js` (`_checkIncoming`, `pendingWallpaper`, `'wallpaper'` event, received-file writing)
- Modify: `core/lib/blobs.js` — `get(ref, { timeoutMs = 0 } = {})` forwards `{ timeout: timeoutMs }` to hyperblobs (0 = wait forever, unchanged default). Ruled after Task 7 review: an unfetchable blob (revoked sender, offline peer, garbage ref) must not wedge the receive/relay loops — callers here and in Task 11 pass a bound (30s) and treat rejection as pending-retry (spec §6).
- Test: `core/test/09-receive.test.js`

**Interfaces:**
- Consumes: view scans (Task 8), BlobStore (Task 7).
- Produces: `'wallpaper'` event `{ id, filePath, fromKey, meta }`; `await core.pendingWallpaper() → entry|null`. Files land at `<storageDir>/received/<id><ext>`. Both fire only with the blob fully written.

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const fs = require('fs')
const b4a = require('b4a')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('receive: target gets wallpaper event with a real file', async function (t) {
  t.plan(4)
  const { creator, joiner } = await pairedDuo(t)

  joiner.on('wallpaper', async ({ id, filePath, fromKey, meta }) => {
    t.is(fromKey, creator.deviceKey)
    t.is(meta.ext, '.png')
    const bytes = await fs.promises.readFile(filePath)
    t.is(bytes.byteLength, 4096)
    t.ok(filePath.includes(id))
  })

  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
})

test('receive: pendingWallpaper pulls the same entry; non-targets see null', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)
  const entry = await joiner.pendingWallpaper()
  t.is(entry.fromKey, creator.deviceKey)

  t.is(await creator.pendingWallpaper(), null, 'sender is not a target')
})

test('receive: only the newest send per target surfaces', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === second.id
  })
  t.pass('stale send is skipped, newest surfaces')
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `index.js`**

```js
const path = require('path')
```

```js
  // Called on every base update (wire in _boot: this.on('update', () => { this._checkIncoming().catch(noop) }))
  async _checkIncoming() {
    if (this.base === null || this._applyBusy) return
    this._applyBusy = true
    try {
      const entry = await this._newestUnappliedForMe()
      if (entry === null) return
      if (this._lastEmitted === entry.id) return
      const filePath = await this._materialize(entry)
      this._lastEmitted = entry.id
      this.emit('wallpaper', { id: entry.id, filePath, fromKey: entry.from, meta: entry.meta })
    } finally {
      this._applyBusy = false
    }
  }

  async _newestUnappliedForMe() {
    let newest = null
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const s = node.value
      if (!s.targets.includes(this.deviceKey)) continue
      if ((await this.base.view.get(k.ack(s.id, this.deviceKey))) !== null) continue
      if (newest === null || s.seq > newest.seq) newest = s
    }
    return newest
  }

  // As-built note (Task 9 fix): _checkIncoming and pendingWallpaper can race
  // into _materialize for the same id (same .part path → deterministic ENOENT).
  // An in-flight dedupe map shares one fetch+write per id; .finally cleanup on
  // success AND failure so a timed-out fetch never poisons retry-next-update.
  _materialize(entry) {
    const existing = this._materializing.get(entry.id)
    if (existing) return existing
    const promise = this._materializeNow(entry).finally(() => {
      this._materializing.delete(entry.id)
    })
    this._materializing.set(entry.id, promise)
    return promise
  }

  async _materializeNow(entry) {
    const dir = path.join(this.storageDir, 'received')
    await fs.promises.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, entry.id + entry.meta.ext)
    try {
      await fs.promises.access(filePath)
      return filePath // already on disk
    } catch {}
    const buffer = await this.blobs.get(entry.blob, { timeoutMs: 30000 }) // bounded: rejection = stays pending, retried next sync
    const tmpPath = filePath + '.part'
    await fs.promises.writeFile(tmpPath, buffer)
    await fs.promises.rename(tmpPath, filePath) // atomic: shells never see partial files
    return filePath
  }

  async pendingWallpaper() {
    if (this.base === null) return null
    const entry = await this._newestUnappliedForMe()
    if (entry === null) return null
    const filePath = await this._materialize(entry)
    return { id: entry.id, filePath, fromKey: entry.from, meta: entry.meta }
  }
```

- [ ] **Step 4: Run the full suite to verify pass.** The event test depends on update firing after replication — if it never fires, check that `_checkIncoming` is wired to the `update` event in `_boot`.

- [ ] **Step 5: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): receive pipeline with atomic file materialization"
```

**Understanding checkpoint:** You can explain the newest-unapplied query, the write-to-`.part`-then-rename trick and what race it prevents, and why `pendingWallpaper()` exists alongside the event (shells that wake up late).

---

### Task 10: Acks — markApplied, delivery status, history

**Learning goal:** Closing the loop: how an `applied` op flowing *back* through the same log gives senders truthful delivery state, and why `superseded` must be computed, not stored.

**Files:**
- Modify: `core/index.js` (`markApplied`, `listReceived`, `_targetStatus` upgrade, `'send-updated'`, scoped `'roster-changed'`)
- Test: `core/test/10-acks.test.js`

**Interfaces:**
- Consumes: receive pipeline (Task 9), `listSends` (Task 8).
- Produces: `await core.markApplied(id)`, `await core.listReceived({ limit = 10 })`, `'send-updated'` `{ id }`; target status now `'pending' | 'delivered' | 'superseded'` (**approved API delta**: superseded = a newer send to the same target was applied). Also: `'roster-changed'` now fires only on actual roster/online changes, `'send-updated'` on ack changes (replace the Task 3 blanket re-emit with a diff of device/ack key counts on update).

- [ ] **Step 1: Write the failing test**

```js
const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('acks: markApplied flips sender status to delivered and fires send-updated', async function (t) {
  t.plan(3)
  const { creator, joiner } = await pairedDuo(t)

  creator.on('send-updated', ({ id }) => t.is(typeof id, 'string'))

  joiner.on('wallpaper', async ({ id }) => {
    await joiner.markApplied(id)
  })

  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(creator, 'update', async () => {
    const [send] = await creator.listSends()
    return send.targets[0].status === 'delivered'
  })
  const [send] = await creator.listSends()
  t.is(send.id, id)
  t.is(send.targets[0].status, 'delivered')
})

test('acks: older send becomes superseded once a newer one is applied', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === second.id
  })
  await joiner.markApplied(second.id)

  await until(creator, 'update', async () => {
    const sends = await creator.listSends()
    const f = sends.find((s) => s.id === first.id)
    return f.targets[0].status === 'superseded'
  })
  t.pass('old send reported superseded, not stuck pending')
})

test('acks: listReceived returns applied history newest-first', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const a = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)
  await joiner.markApplied((await joiner.pendingWallpaper()).id)

  const received = await joiner.listReceived()
  t.is(received.length, 1)
  t.is(received[0].id, a.id)
  t.is(typeof received[0].appliedAt, 'number')
  t.ok(received[0].filePath.endsWith('.png'))
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `index.js`**

```js
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
```

Scoped events — replace the Task 3 blanket `roster-changed` re-emit: on each `update`, count `device/` rows and `ack/` rows (two quick scans); emit `'roster-changed'` when the device count or set changed, and `'send-updated'` `{ id }` for each new ack whose send this device authored. Keep the implementation simple (cache last-seen key lists on `this._lastDevices` / `this._lastAcks`).

- [ ] **Step 4: Run the full suite to verify pass.**

- [ ] **Step 5: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): applied acks, delivery/superseded status, received history"
```

**Understanding checkpoint:** You can explain why `superseded` is derived at read time instead of written as an op (no device is responsible for writing it, and derivation keeps apply simpler and the log smaller), and why `markApplied` lives with the shell's setter success, not with the download.

---

### Task 11: sync(), relaying, and offline delivery

**Learning goal:** How queued delivery actually happens with nobody special in charge — every member downloads pending blobs so any member can serve them — and what a bounded sync round means for the Android lifecycle.

**Files:**
- Modify: `core/index.js` (`sync`, `_relayBlobs`)
- Test: `core/test/11-offline.test.js`

**Interfaces:**
- Consumes: everything.
- Produces: `await core.sync({ timeoutMs = 30000 })` — resolves when the swarm settled and pending work (incoming wallpaper materialization + relay downloads) finished, or on timeout, whichever first.

- [ ] **Step 1: Write the failing test — the marquee scenario**

```js
const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// Build a 3-device group: creator invites B, then C, approving each.
async function trio(t) {
  const tn = await makeTestnet(t)
  const mk = async (name) => {
    const c = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: name, bootstrap: tn.bootstrap })
    await c.ready()
    return c
  }
  const a = await mk('desktop')
  await a.createGroup()
  a.on('pairing-request', ({ candidateKey }) => a.approve(candidateKey))
  const b = await mk('laptop')
  await b.joinGroup(await a.createInvite())
  const c = await mk('phone')
  await c.joinGroup(await a.createInvite())
  return { a, b, c, tn }
}

test('offline delivery: relay carries a send after the sender leaves', async function (t) {
  const { a, b, c } = await trio(t)
  t.teardown(async () => { await b.close() })

  const cDir = c.storageDir

  // 1. phone (c) goes offline
  await c.close()

  // 2. desktop (a) sends to phone, waits until laptop (b) relayed the blob, then leaves
  const { id } = await a.sendWallpaper(fakePng(), [c.deviceKey])
  await b.sync({ timeoutMs: 15000 }) // b pulls the op AND the blob, becoming the relay
  await a.close()

  // 3. phone returns; only the relay is online
  const c2 = new WallpaperCore({ storageDir: cDir, deviceName: 'phone', bootstrap: b.bootstrap })
  await c2.ready()
  t.teardown(() => c2.close())
  await c2.sync({ timeoutMs: 15000 })

  const entry = await c2.pendingWallpaper()
  t.ok(entry !== null, 'wallpaper delivered via relay')
  t.is(entry.id, id)
})
```

(`b.bootstrap` works because the constructor already stores it as a public property.)

- [ ] **Step 2: Run to verify failure** — `sync is not a function`.

- [ ] **Step 3: Implement in `index.js`**

```js
  // Download blobs for EVERY unapplied send (not just ours), so this
  // device can serve them to targets later. This is what makes any
  // online member a relay (spec §5).
  async _relayBlobs() {
    if (this.base === null) return
    for await (const node of this.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) {
      const s = node.value
      let done = true
      for (const target of s.targets) {
        if ((await this.base.view.get(k.ack(s.id, target))) === null) done = false
      }
      if (done) continue
      await this.blobs.get(s.blob, { timeoutMs: 30000 }).catch(() => {}) // bounded best effort; retried next sync
    }
  }

  async sync({ timeoutMs = 30000 } = {}) {
    if (this.opened === false) await this.ready()
    if (this.base === null) return
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })
    const work = (async () => {
      await this.swarm.flush()          // announced + pending connections done
      await this._settle(timeoutMs)     // see as-built note below
      await this._relayBlobs()
      await this._checkIncoming()
    })().catch(noop)                    // sync() must never reject (as-built fix)
    await Promise.race([work, timeout])
    clearTimeout(timer)
  }
```

**As-built note (Task 11):** autobase 7.x's `base.update()` only re-linearizes
*already-local* data — it does not wait for network replication (verified at
source; the sole network-waiting path is gated behind an option we don't use).
`_settle(timeoutMs)` replaces it with a two-phase wait: `base.update()`, then —
if any gated connection exists — wait for the FIRST `'update'` event under
`min(timeoutMs, 5000)` (replication starts strictly after flush because the
roster gate is async, so a bare quiet-window would miss slow links
systematically), then a 250ms quiet window, then a final `base.update()`.
Both waits clean their listeners on every exit path.

Also call `this._relayBlobs().catch(noop)` from the `update` handler in `_boot` (alongside `_checkIncoming`), so long-running desktops relay continuously, not only during explicit sync.

- [ ] **Step 4: Run the full suite** — this test is the slowest and flakiest-prone; if the relay leg fails, assert intermediate state (does `b` hold the blob after its sync? check `b.blobs.get(...)` resolves fast) to localize which hop broke.

- [ ] **Step 5: Commit + journal line**

```bash
git add -A && git commit -m "feat(core): bounded sync and blob relaying for offline delivery"
```

**Understanding checkpoint:** You can narrate the relay scenario hop by hop, explain why relaying is *pull by everyone* rather than *push by the sender*, and describe how the Android shell will use `ready → sync → pendingWallpaper → setter → markApplied → close`.

---

### Task 12: Scenario matrix, restart persistence, and the API README

**Learning goal:** Consolidation — proving the invariants hold when features interact, and writing the API docs that Plans 2–3 build against.

**Files:**
- Create: `core/README.md`
- Test: `core/test/12-scenarios.test.js`

**Interfaces:**
- Consumes: everything. Produces the documented, frozen surface for Plan 2 (desktop) and Plan 3 (Android).

- [ ] **Step 1: Write the failing scenario tests** (reuse `trio(t)` — move it into `helpers.js`)

```js
const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../index.js')
const { trio, until, tmpDir } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('scenario: multi-target send delivers to both, each acks independently', async function (t) {
  const { a, b, c } = await trio(t)
  t.teardown(async () => { await a.close(); await b.close(); await c.close() })

  const { id } = await a.sendWallpaper(fakePng(), [b.deviceKey, c.deviceKey])
  for (const peer of [b, c]) {
    await until(peer, 'update', async () => (await peer.pendingWallpaper()) !== null)
    await peer.markApplied((await peer.pendingWallpaper()).id)
  }
  await until(a, 'update', async () => {
    const [send] = await a.listSends()
    return send.targets.every((x) => x.status === 'delivered')
  })
  const [send] = await a.listSends()
  t.is(send.id, id)
  t.is(send.targets.length, 2)
})

test('scenario: full state survives restart of every member', async function (t) {
  const { a, b, c } = await trio(t)
  const dirs = { a: a.storageDir, b: b.storageDir, c: c.storageDir }
  const bootstrap = a.bootstrap
  await a.sendWallpaper(fakePng(), [c.deviceKey])
  await b.sync({ timeoutMs: 15000 })
  await a.close(); await b.close(); await c.close()

  const b2 = new WallpaperCore({ storageDir: dirs.b, deviceName: 'laptop', bootstrap })
  await b2.ready()
  const c2 = new WallpaperCore({ storageDir: dirs.c, deviceName: 'phone', bootstrap })
  await c2.ready()
  t.teardown(async () => { await b2.close(); await c2.close() })

  t.is(b2.groupStatus, 'member')
  t.is((await b2.listDevices()).length, 3)

  await c2.sync({ timeoutMs: 15000 })
  t.ok((await c2.pendingWallpaper()) !== null, 'queued send survived everyone restarting')
})

test('scenario: revoked device cannot receive a subsequent send', async function (t) {
  const { a, b, c } = await trio(t)
  t.teardown(async () => { await a.close(); await b.close(); await c.close() })

  await a.removeDevice(c.deviceKey)
  await t.exception(
    () => a.sendWallpaper(fakePng(), [c.deviceKey]),
    /not in the roster/
  )
  const roster = await a.listDevices()
  t.is(roster.length, 2)
})
```

- [ ] **Step 2: Run to verify the new tests fail only for missing helpers, fix helpers, then all pass.**

- [ ] **Step 3: Write `core/README.md`** — the API contract for Plans 2–3: every public method/event with its exact signature (copy from spec §3.1 plus the `superseded` delta), the shell lifecycle recipes (desktop: `ready()` once, listen to events; Android: `ready → sync → pendingWallpaper → setter → markApplied → close`), and the storage layout (`corestore/`, `received/`).

- [ ] **Step 4: Full suite green, then commit and tag the milestone**

```bash
cd core && npm test
git add -A && git commit -m "feat(core): scenario matrix, restart persistence, API README"
git tag core-v0.1.0
```

- [ ] **Step 5: Update the spec** — if any API detail drifted during implementation (e.g. `superseded`), fold the final surface back into spec §3.1 in the same commit, and note it in `docs/notes/JOURNAL.md`.

**Understanding checkpoint:** You can state the system's invariants from memory (only rostered devices connect; every op is authored by a rostered writer; a send is immutable once appended; an ack only ever follows a successful apply; state is a pure function of the log) — and you know which test proves each one.

---

## After this plan

- **Plan 2 (desktop):** Pear app skeleton, macOS/Windows setter smoke scripts, minimal UI over the core README contract. Milestone: two real machines swap wallpapers.
- **Plan 3 (Android):** Expo + react-native-bare-kit worklet, RPC bridge, WallpaperManager module, background task, share-sheet target. Milestone: three-device e2e checklist from spec §7.
