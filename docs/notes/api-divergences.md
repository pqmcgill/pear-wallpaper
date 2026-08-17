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
