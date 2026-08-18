# QA script: pairing, policy, revocation (Tasks 1–6)

Two Node REPLs on one machine = two devices. Uses the real hyperswarm DHT:
needs internet; first discovery can take ~10–60s. Separate storageDirs are
what make the processes distinct devices.

> **Known REPL quirk:** `DEP0097 DeprecationWarning ... _onsend on UDXSocket`
> is a Node-REPL-only artifact (the REPL still wraps evaluation in the legacy
> `domain` module; udx-native's callbacks trigger the deprecation). Harmless,
> never appears in script/test runs or the real apps. Silence with
> `node --no-deprecation` if desired. Also: the REPL won't let you redeclare
> a `const` — use a fresh name if you fumble a line.

Setup (both terminals): `cd core && node`

## Act 1 — Creator (Terminal A)

```js
const WallpaperCore = require('./index.js')
const a = new WallpaperCore({ storageDir: '/tmp/pw-qa/desktop', deviceName: 'desktop' })
await a.ready()
a.deviceKey            // 64-char hex — this device's identity
a.groupStatus          // 'none'
await a.createGroup()
a.groupStatus          // 'member'
await a.listDevices()  // self, isCreator: true

a.on('pairing-request', ({ candidateKey, name }) =>
  console.log('\n=== PAIRING REQUEST ===', name, candidateKey))

const invite = await a.createInvite()
invite                 // copy this string
```

## Act 2 — Joiner (Terminal B)

```js
const WallpaperCore = require('./index.js')
const b = new WallpaperCore({ storageDir: '/tmp/pw-qa/phone', deviceName: 'phone' })
await b.ready()
b.deviceKey            // note it — verify it in Terminal A's pairing request
const p = b.joinGroup('<PASTE INVITE>')   // do NOT await yet
b.groupStatus          // 'joining'
```

## Act 3 — Approval gate (Terminal A)

Wait for `=== PAIRING REQUEST ===`. **Verify the key matches `b.deviceKey`**
— that verification is the human gate's whole job. Then:

```js
await a.approve('<candidateKey>')
await a.listDevices()  // 2 devices, phone online: true
```

Terminal B: `await p` resolves; `b.groupStatus === 'member'`;
`await b.listDevices()` shows both. Pairing complete.

Deny path (optional): mint a fresh invite, third instance joins,
`a.deny(key)` — the joiner's `joinGroup` rejects with a real error.

## Act 4 — Things that must fail (Terminal B)

```js
await b.createInvite()             // throws: only the creator can invite
await b.removeDevice(a.deviceKey)  // throws: only the creator can remove devices
// Forge a raw op past the method gates:
const ops = require('./lib/ops.js')
await b._append(ops.removeDevice({ key: a.deviceKey }))
await b.listDevices()              // still 2 — apply ignored the forgery, even on the forger
```

## Act 5 — Restart persistence (Terminal B)

```js
await b.close(); .exit
```

New `node`, reopen the same storageDir: `groupStatus` is `'member'`, roster
intact before any network contact (replayed from local logs).

## Act 6 — Revocation (Terminal A)

```js
await a.removeDevice('<b.deviceKey>')
await a.listDevices()   // 1 device
```

B's connection drops; reconnects are refused at the gate. B keeps its old
replicated data — revocation stops the future, not the past (by design).

Cleanup: `rm -rf /tmp/pw-qa`. Not QA-able yet: sendWallpaper/pendingWallpaper
(Tasks 7–10); invite expiry (24h window).
