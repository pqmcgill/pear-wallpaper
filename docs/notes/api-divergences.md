# API divergences from task briefs

Record any place the pinned dependency's real API differs from what a task
brief assumed, and how it was resolved. One entry per divergence.

## Task 3: Autobase constructor needs `valueEncoding: 'json'`

- **Brief assumed:** `new Autobase(this.store, key, { encrypt, encryptionKey, open, apply })`
  with ops appended as plain JS objects, no `valueEncoding` option.
- **Reality (autobase@7.28.1):** `Autobase`'s default `valueEncoding` is
  `'binary'` (`this.valueEncoding = c.from(handlers.valueEncoding || 'binary')`
  in `autobase/index.js`). Appending a plain object under the binary encoding
  fails deep inside `compact-encoding` with
  `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range ... Received NaN`
  (compact-encoding tries to read `.byteLength` off a plain object).
- **Resolution:** added `valueEncoding: 'json'` to the Autobase constructor
  options in `core/index.js` `_boot()`, exactly as the task instructions
  anticipated ("If appends fail to round-trip as JSON objects, add
  `valueEncoding: 'json'`"). Ops remain plain JSON objects in `ops.js`/`apply.js`,
  unchanged from the brief.
- **Everything else checked against the brief matched the installed
  autobase@7.28.1 source, no changes needed:**
  - `node.from.key` — `apply-state.js` sets `from: node.writer.core` (a
    Hypercore instance) on each apply-batch entry; `node.from.key` is that
    core's public-key Buffer. Confirmed by autobase's own internal use of
    `node.from.key` in `createAnchor()` (`lib/apply-state.js:1465`).
  - `apply(nodes, view, base)`'s third argument is a `PrivateApplyCalls`
    instance (`lib/apply-calls.js`) with `addWriter(key, opts)` and
    `removeWriter(key)` methods — matches the brief's `base.addWriter(...)` /
    `base.removeWriter(...)` calls.
  - `open: (store) => ...` receives the `AutoStore` as its first argument;
    `store.get('view')` — a bare string — is normalized to `{ name: 'view' }`
    inside `AutoStore.get()` (`lib/store.js:193-201`), matching
    `reference/autopass/index.js`'s usage.
  - `encrypt: true` with `encryptionKey: undefined` on first `createGroup()`
    causes `boot()` (`lib/boot.js`) to generate and persist a fresh encryption
    key on the local core; passing the persisted hex back in as
    `encryptionKey` on reopen reuses it. Matches the brief's reopen path via
    `meta.get('group')`.

## Task 4: blind-pairing API matched the brief; two minor notes

- **Checked against installed `blind-pairing@2.x` and `blind-pairing-core`
  source** (`core/node_modules/blind-pairing/index.js`,
  `core/node_modules/blind-pairing-core/index.js`): `Member`'s `onadd`
  receives a `MemberRequest` (has `.inviteId`, `.open(publicKey)` →
  returns/sets `.userData`, `.confirm({key, encryptionKey, additional})`,
  `.deny()`), and `Candidate`'s `onadd` receives the resolved
  `{ key, encryptionKey, data }` auth object. `member.flushed()` exists on
  `Member` and proxies to the swarm discovery-topic's `.flushed()`.
  `BlindPairing.createInvite(key)` returns
  `{ id, invite, seed, publicKey, additional, discoveryKey, expires,
  sensitive, testInvitation }` — the brief's destructuring of
  `{ id, invite, publicKey, expires }` is a correct subset. No code changes
  were needed beyond what the brief specified verbatim.
- **`additional` is `null` in this task:** `createInvite` is called with no
  second argument, so `blind-pairing-core`'s `createInvite(key, opts = {})`
  never receives `opts.data`, making `additional: null`. Nothing to thread
  through Task 5 as a result — the invite record stored in the view
  (`id`, `invite`, `publicKey`, `expires`) has no `additional` field to add.
  Flagged per the task-4 instructions for the controller to confirm Task 5
  doesn't need it.
- **Unused `compact-encoding` (`c`) import:** the brief's Step 3 require
  block for `core/index.js` lists `const c = require('compact-encoding')`,
  copied from the autopass reference (which uses `c.encode`/`c.decode` for
  structured `userData`/invite metadata). This task's candidate `userData`
  is plain JSON (per the interface spec), so `c` ends up unused in
  `index.js`. Kept the require for fidelity to the brief's verbatim code
  rather than silently dropping it; noting it here as a leftover rather
  than a functional divergence.
