# QA script: Android shell (Expo/RN + Bare worklet)

Companion to `docs/notes/qa-desktop.md`, for the RN shell built in
`docs/superpowers/plans/2026-08-23-android-shell.md`. Topology:

```
app/index.js + components/* (RN, expo-router)
  ⇄ SnapshotContext (app/_layout.js — useReducer(reduce, initialSnapshot),
    AppState suspend/resume)
  ⇄ getBridge()/getWorklet() (lib/worklet-client.js — module-level
    singleton, single-writer rule enforcement point 1)
  ⇄ newline-JSON transport over worklet.IPC (react-native-bare-kit's
    Worklet, running the bare-pack bundle at app/gen/worklet.bundle.mjs)
  ⇄ worklet/host.js (WallpaperCore + sync-engine + bridge-main — the same
    core stack as desktop, running on Bare's Android prebuilds inside the
    RN process, not a separate sidecar)
```

Needs the Android emulator (or a device) and a from-scratch `npm run
android` bundles first — the dev-loop rule (`bundle:worklet` regenerates
`app/gen/worklet.bundle.mjs`, then `expo run:android` builds/installs/runs).

## Act 1 — Onboarding renders via the real core (2026-08-23)

```bash
cd /Users/patrick/code/pear-wallpaper/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
npm run android
```

Expect, and what was actually observed on `emulator-5554` (Pixel-class AVD,
API level matching `minSdkVersion 31`):

1. **Bundle + build succeed.** `bundle:worklet` regenerated
   `app/gen/worklet.bundle.mjs`; the gradle build completed
   (`BUILD SUCCESSFUL`) and Metro bundled `expo-router/entry.js` (1218
   modules) with no errors.
2. **Onboarding renders — not blank, no red-box.**
   `adb exec-out screencap -p` showed:
   - "Pear Wallpaper" title
   - "Create a group" button
   - a "Paste invite" text input
   - "Join a group" button

   This alone is most of the round-trip check, same argument as desktop QA
   Act 1: `app/_layout.js`'s `useEffect` calls `getBridge()` (which sends
   the init frame the instant the Worklet starts) and
   `bridge.call('getState')` on mount; painting Onboarding without an RN
   "red box"/crash means RN mounted, the Worklet process started and did
   not immediately die, and the JS thread proceeded past the bridge setup.
3. **Stronger proof — pressed "Create a group" live on the emulator**
   (`adb shell input tap`) rather than stopping at the screenshot. This
   requires the full pipeline to work end-to-end, not just fail to crash:
   `Onboarding`'s `create()` → `bridge.call('createGroup')` → `{t:'req',
   cmd:'createGroup'}` over the real transport → `worklet/host.js`'s
   `createBridgeMain` → the real `WallpaperCore.createGroup()` (real
   Autobase/Corestore/Hyperswarm) → `core.on('update')` fires →
   `bridge-main` pushes a `state` evt with `groupStatus: 'member'` →
   `lib/store.js`'s `reduce` folds it in → `app/index.js` re-routes on
   `snapshot.groupStatus === 'member'`. The screen changed to `MainView`'s
   placeholder text **"Devices in group: 1"** — a real roster entry for
   the device that just created the group, not a stub. Screenshots
   (gitignored, not committed): `qa-screenshot-1.png` (Onboarding),
   `qa-screenshot-2-after-create.png` (MainView after Create).
4. **Filesystem proof of the storageDir path fix** (Task 4's `Paths.document.uri`
   → plain-path stripping, see `docs/notes/api-divergences.md`):
   ```bash
   adb shell run-as com.pearwallpaper.app ls -la files/pear-wallpaper/corestore
   ```
   showed a real `CORESTORE` file and rocksdb `db/` directory at exactly
   `<Paths.document>/pear-wallpaper/corestore` — confirming the `file://`
   scheme was stripped correctly and `core/index.js`'s
   `new Corestore(storageDir + '/corestore')` opened against a real,
   writable native path rather than failing silently or writing somewhere
   unexpected.
5. **`adb logcat`** for the app's pid, filtered for
   `fatal|error|exception|crash`, showed nothing from the worklet or the
   bridge — only one known-benign RN Bridgeless warning/soft-exception
   (`ReactNoCrashSoftException: raiseSoftException(onWindowFocusChange...)`,
   a cold-start window-focus race in RN's new architecture, unrelated to
   this app's code). No `worklet/host.js` `console.error('[worklet] init
   failed', ...)` line appeared, consistent with init succeeding (that
   line only fires on the terminal-error path). Note: unlike the Task 2
   echo screen's `console.log`, `worklet/host.js` only logs on failure —
   `adb logcat -s bare` produces no output on a clean run; absence of
   `[worklet] init failed` is the signal to check for, not a positive log
   line.

**Cleanup:** `adb shell pm clear com.pearwallpaper.app` after this Act, so
the app starts at a fresh `groupStatus: 'none'`/Onboarding for whoever runs
the next Act (Task 5's camera/scan work).

`npm run test:ui` (11/11) and `npm run test:worklet` (2/2 tests, 8/8
asserts) both green in the same tree.

## Act 2 — QR scan + join flow; first cross-platform pair (2026-08-23)

New this Act: `components/ScanInvite.js` (`expo-camera`'s `CameraView` +
`useCameraPermissions`, latched `onBarcodeScanned`), a "Scan invite" button
on `Onboarding`, and `joinError` display + retry copy on `Waiting`. Full
rebuild required (`npm run android`) since `expo-camera` adds a native
Kotlin module and a manifest permission — a JS-only reload isn't enough for
that part. `npm run test:ui`: 14/14 (11 carried over + 3 new
`scan-invite.test.js` cases: latch on repeated `onBarcodeScanned`,
`barcodeScannerSettings: {barcodeTypes:['qr']}`, and permission-denied
fallback + cancel). `npm run test:worklet`: unchanged, 2/2 tests, 8/8
asserts.

**No desktop GUI in this session.** Per the milestone's own logic (an
admitting member just needs to be *online*, not necessarily the packaged
Electron app), Act 2's cross-platform proof uses a scripted stand-in for
the desktop: a throwaway Node script run from `desktop/` (so it resolves
`desktop/node_modules/pear-wallpaper-core`, a symlink to `../core`) that
calls the exact same `WallpaperCore` API the desktop worker calls —
`new WallpaperCore({ storageDir, deviceName: 'qa-desktop' })` →
`ready()` → `createGroup()` → `createInvite()` → print it → listen for
`pairing-request` → `approve()`/`deny()` → print `listDevices()` on
`roster-changed`. This is a legitimate group peer, not a mock — same
Autobase/Corestore/Hyperswarm stack, same events, same gate. The **real**
human path this substitutes for (documented per the brief, not run here):
on a Mac with a display, `cd desktop && npm run dev`, click "Create a
group" in the Electron window, and `DeviceList` renders the invite as text
+ QR (via `qrSvg`) instead of printing to a terminal.

### Setup

```bash
# Terminal A — scripted desktop peer (see docs/notes/qa-pairing.md for the
# equivalent raw-REPL version this mirrors)
cd desktop && node qa-desktop-peer.js   # throwaway script, not committed

# Terminal B — emulator
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
adb shell pm clear com.pearwallpaper.app && adb shell am start -n com.pearwallpaper.app/.MainActivity
```

**adb coordinate gotcha hit live:** screenshots read back into this
session are shown scaled (900×2000 preview of a real 1080×2400 device) —
tapping at the *preview's* pixel coordinates instead of multiplying by
the 1.2 scale factor landed a "Join a group" tap on "Create a group"
instead the first time, silently creating a solo group on the device
rather than joining. Recovered by `pm clear` and redoing the tap with
real-device coordinates (`adb shell wm size` → `1080x2400`). Recorded
here since it's an easy trap for any future adb-driven QA on this
project.

### Happy path — invite → candidate → approval → roster sync

1. Terminal A printed a real invite string, e.g.
   `yrb9az5kik43j9sdsrfir5ob4uiqqeqqmcypnfw7xgu749aso3ope7bhuugha7bsjbgr4j6c88k35gpqk6g1dfkudaq6qru8kzup4h6mqc4g9ddk`.
2. On the emulator: tapped the "Paste invite" field, `adb shell input text
   "<invite>"`, dismissed the keyboard (`input keyevent 111`), tapped
   "Join a group".
3. Terminal A logged, in order: `=== ROSTER CHANGED ===` (the joiner's
   candidate connection opening — see the "Waiting during a live join"
   finding below), `=== PAIRING REQUEST ===` with the candidate's key and
   `name: 'sdk_gphone64_arm64'` (the emulator's `Device.modelName`,
   matching Task 4's worklet-client init frame), then `approving...`,
   then a second `=== ROSTER CHANGED ===` showing both devices with the
   phone `online: true`, then `approved <candidateKey>`.
4. The emulator screen transitioned straight to `MainView`'s placeholder:
   **"Devices in group: 2"**. Screenshot evidence:
   `qa2-joining2.png` (not committed, gitignored scratch dir).
5. Re-verified end-to-end a second time after the fix below (see next
   section) with a fresh invite: same result, **"Devices in group: 3"**
   (the extra count is stale roster entries from earlier attempts in this
   same QA session — the scripted peer's group was reused across
   sub-Acts, never revoked; not a bug, just accumulated test fixtures).

This is the milestone: a real QR-able invite string minted by one shell
(standing in for desktop), consumed by the Android emulator's real
`joinGroup()` over the real DHT, redeemed as a blind-pairing candidate,
approved by a human-equivalent gate on the other shell, and settled into
a synced two-(then three-)device roster on both sides.

### Finding + fix: live joins route through Waiting too, and its error map never matched

While exercising the deny path (below), discovered two real bugs — fixed
in this Act, not just observed:

1. **`Waiting`, not `Onboarding`, is what's mounted when a live join is
   rejected.** The existing code comment (mirrored from
   `desktop/ui/app.js`) assumed an interactive `joinGroup()` call keeps
   `Onboarding` mounted for its whole duration, so rejections could be
   handled entirely in its local state. That's wrong: `core/index.js`'s
   `_onConnection` fires `roster-changed` the moment a gated connection
   opens on *either* side — including the joiner's own candidate socket,
   well before `joinGroup()`'s promise settles. `bridge-main` forwards
   that as a `state` push with `groupStatus: 'joining'`, so `app/index.js`
   routes to `Waiting` immediately, unmounting `Onboarding`. Reproduced by
   denying a live candidate: the emulator was left on a bare "Waiting for
   an existing device…" screen with no error, forever — `Onboarding`'s
   `catch` had set `joinError` on a component nobody could see.
   **Fix:** `app/index.js` now passes `dispatch` to `Onboarding`;
   `attemptJoin`'s catch also dispatches the raw rejection into shared
   `snapshot.joinError` (the store's existing `'error'` reducer case
   already routes it there whenever `groupStatus === 'joining'`, which by
   then it is). Local `joinError` state is kept too, for the case that
   never opens a real connection (garbage invite, below) where
   `Onboarding` genuinely does stay mounted.
2. **The friendly-message lookup tables never matched.**
   `blind-pairing-core`'s coded errors format `Error#message` as
   `` `${code}: ${msg}` `` (e.g. `'PAIRING_REJECTED: Pairing was
   rejected'`), not the bare code, and `bridge-main`/`bridge-ui` only
   relay `.message` across the wire (`.code` is dropped). Both
   `Onboarding`'s `JOIN_ERROR_MESSAGES` and `Waiting`'s `MESSAGES` did an
   exact-match object lookup keyed by the bare code, so every rejection
   silently fell through to the generic fallback text. This bug is also
   present in `desktop/ui/components/{Onboarding,Waiting}.js` (same
   exact-match pattern) — not fixed there in this task, out of scope, but
   worth flagging for a follow-up.
   **Fix (Android only, per this task's scope):** both lookups now match
   by prefix (`message.startsWith(code)`), which also still exact-matches
   the plain `'superseded by a newer invite'`/`'closed'` messages.
   Confirmed live: after the fix, a real deny renders **"The creator
   denied this device."** on `Waiting`, not the generic fallback.

`docs/superpowers/plans/2026-08-23-android-shell.md`'s Task 5 brief listed
only `Onboarding.js`/`Waiting.js`/`app.json`/`package.json`/this file as
files to modify; `app/index.js` was touched too, narrowly, to thread
`dispatch` — necessary for the brief's own explicit QA scenario ("deny →
Waiting shows rejection") to actually be true rather than asserted.

### Deny path

Fresh invite from Terminal A, script denies instead of approves
(`core.deny(candidateKey)`). Live candidate key logged, e.g.
`43ab363fbd2957f05b066f3606e6c1018eae1e2c5c399ca3cfd464efd54ef884`.
Emulator: routed to `Waiting` (per the finding above) mid-flight, then
settled on **"The creator denied this device."** with the new retry copy
**"Ask the creator for a fresh invite, then restart the app and paste it
to try again."** below it. `ErrorBanner` also appeared at the top showing
the raw `"PAIRING_REJECTED: Pairing was rejected"` — a pre-existing,
unrelated cosmetic gap (no `SafeAreaView` anywhere in this app, so
`ErrorBanner`, the one element pinned to the very top, overlaps the status
bar; every other screen has enough top whitespace to hide the same gap).
Out of scope for this task; noted for a future polish pass.

### Garbage invite

Typed `not-a-real-invite-garbage-string-1234` into the paste field and
pressed "Join a group". This never opens a real connection (not
z32-decodable to a real discovery key), so no `roster-changed` fires and
`Onboarding` stays mounted throughout — its own local `joinError` state
rendered **"Could not join. Ask for a fresh invite."** directly under the
"Join a group"/"Scan invite" buttons, as designed.

### Camera path — human-only, documented not automated

Per the environment brief, the emulator's virtual-scene camera image can
only be loaded through the Android Studio Emulator Extended Controls GUI
(Camera → Virtual scene → Add image), which isn't drivable headlessly in
this session, and this session has no way to render the desktop's actual
QR `<svg>` to a screen for the emulator's camera to see in the first
place. Not attempted; the real human procedure, for whoever runs this
next with a display:

1. `cd desktop && npm run dev`, create a group, open `DeviceList`,
   "Create invite" — renders both the raw invite string and a QR `<svg>`
   (`qrSvg`, `desktop/ui/qr.js`).
2. Screenshot that QR.
3. Android Studio's Emulator → Extended controls → Camera → Virtual
   scene → load the screenshot as the scene's poster image.
4. In the app, "Scan invite" → grant camera permission → point the
   emulated camera at the virtual-scene image bearing the QR.
5. `ScanInvite`'s `onBarcodeScanned` should latch on the first decode
   (unit-tested in `scan-invite.test.js`) and call `onScanned`, which
   routes into the identical `attemptJoin` the paste path uses — same
   approve/deny/error behavior as verified above, just a different way to
   get the invite string into the app.

The paste path (Acts above) already exercises every downstream behavior
`ScanInvite` hands off to (`attemptJoin`, `Waiting`, error copy); the
camera adds only the scan step itself, which is unit-tested in isolation
(mocked `expo-camera`) rather than device-QA'd this round.

### Cleanup

`adb shell pm clear com.pearwallpaper.app` after each sub-Act (fresh
`groupStatus: 'none'`/Onboarding for whoever runs next); scripted desktop
peer processes killed; throwaway `desktop/qa-desktop-peer*.js` scripts
deleted (never committed — `git status` clean before commit).

`npm run test:ui`: 14/14 pristine. `npm run test:worklet`: unchanged, 2/2
tests, 8/8 asserts.

## Act 3 — WallpaperManager Expo module + apply controller; first cross-platform wallpaper apply (2026-08-23)

New this Act: `android/modules/wallpaper-setter/` (a local Expo Module,
scaffolded via `npx create-expo-module@latest --local wallpaper-setter`,
autolinked from `modules/` with no npm package — see
`docs/notes/api-divergences.md` for the generated-layout divergences),
`lib/apply-controller.js` (`createApplyController`, coalesced-pass
`applyPending()` mirroring `sync-engine.applyPending`'s semantics exactly),
and wiring in `app/_layout.js`: the controller runs after every `state`
push and once after the initial `getState`, `getTarget` hardcoded to
`'home'`. `app.json` gained `android.permissions:
["android.permission.SET_WALLPAPER"]`. `npm run test:ui`: 26/26 (23
carried over + 3 new `apply-controller.test.js` cases: in-order
setter-then-markApplied, a setter failure leaves the item unacked, and
concurrent triggers coalesce to exactly one queued rerun). `npm run
test:worklet`: unchanged, 2/2 tests, 8/8 asserts.

Native module added ⇒ full rebuild, not just a Metro reload
(`npm run android`).

### Setup

Same scripted-desktop-peer pattern as Act 2, extended to also send a
wallpaper: `desktop/qa-peer-tmp.js` (throwaway, not committed) —
`createGroup()` → `createInvite()` → on `pairing-request`, `approve()` →
once the joiner's roster entry shows `online: true`, `sendWallpaper(imagePath,
[joiner.key])` → poll `listSends()` until the target's status flips to
`'delivered'` (the ack round-trip proof: `markApplied` on the phone ->
`send-updated` on the desktop). Test image: a distinctive 480×480 solid
bright-magenta PNG, hand-built with raw PNG chunks + `zlib.deflateSync`
(`scratchpad/gen-png.js`, throwaway) — unmistakable against the emulator's
default light wallpaper.

```bash
# Terminal A — scripted desktop peer, extended for Act 3
cd desktop && node qa-peer-tmp.js /path/to/qa-wallpaper.png

# Terminal B — emulator, same env exports as Acts 1-2
adb -s emulator-5554 shell input tap <paste-field-x> <paste-field-y>
adb -s emulator-5554 shell input text "<invite>"
adb -s emulator-5554 shell input keyevent 4   # dismiss keyboard
adb -s emulator-5554 shell input tap <join-button-x> <join-button-y>
```

### Bug found + fixed: `app.json`'s `android.permissions` never reached the built APK

**Symptom**: after wiring the controller and adding
`android.permissions: ["android.permission.SET_WALLPAPER"]` to
`app.json`, then running `npm run android`, pairing and blob delivery
both worked (confirmed via temporary `console.log` instrumentation — see
below), but every `setWallpaper()` call rejected:
`SecurityException: Access denied to process: 8286, must have permission
android.permission.SET_WALLPAPER`. `adb shell dumpsys package
com.pearwallpaper.app` confirmed the installed APK's manifest had no
`SET_WALLPAPER` entry at all, despite `app.json` listing it.

**Root cause**: `android/android/` is CNG-regenerated, gitignored output
(`android/.gitignore`: `android/`), but `expo run:android` only runs
`expo prebuild` when that directory is *absent* — if it already exists
(as it did, carried over from Tasks 1-5), `npm run android` just
rebuilds/reinstalls the existing native project and never re-reads
`app.json`'s `android.permissions` field into the manifest. (Contrast
with `expo-camera` in Task 5: that permission came for free via Gradle's
manifest merger pulling in `expo-camera`'s own library
`AndroidManifest.xml` — unrelated to `app.json` entirely, so Task 5 never
hit this gap.)

**Fix**: `npx expo prebuild --platform android --clean` (regenerates
`android/android/` from `app.json` + the local module) before the
rebuild. Confirmed via `grep -n "uses-permission"
android/android/app/src/main/AndroidManifest.xml` (now lists
`SET_WALLPAPER`) and `adb shell dumpsys package com.pearwallpaper.app`
(`android.permission.SET_WALLPAPER: granted=true`) after reinstalling.
Documented in `docs/notes/api-divergences.md` for whoever next adds an
`app.json`-only permission on a machine where `android/android/` already
exists.

**How it was found**: temporary `console.log('[QA-DEBUG] ...')` lines in
`apply-controller.js`, `modules/wallpaper-setter/index.js`, and
`_layout.js`'s `state` handler (all reverted before commit — `git diff`
confirmed clean), plus running `npx expo start --dev-client` with its
stdout redirected to a file (`nohup ... &`, `disown`, so it survives the
bash tool's ephemeral shell) rather than piped straight into a
short-lived tool call — RN's `console.log` in this dev-client setup goes
to the Metro terminal, not `adb logcat` (confirmed: zero `ReactNativeJS`
lines in a full `adb logcat` capture across an entire pairing+send
cycle). This is the practical answer to "check `adb logcat -s bare` for
the sync trace" — `-s bare` filters for a tag that doesn't appear in this
topology; the real signal is Metro's own log.

### Finding (flagged, not fixed — pre-existing, outside Task 6's scope): a resumed group can leave the UI stuck on `Onboarding`

While iterating on the permission fix above, repeated `am force-stop`
+ `am start` cycles against an app that already had a *persisted* group
membership (from an earlier successful pairing this session) left the UI
showing `Onboarding` indefinitely, even though the core was genuinely a
member — confirmed by tapping "Join a group" again and getting `joinGroup
REJECTED already in a group` in the Metro log (`core.groupStatus`
returns `'member'` off the exact same `this.base !== null` check
`joinGroup()` uses, so the core-side state was never in doubt).

**Likely cause**: `worklet/host.js` awaits `core.ready()` — which, for a
device resuming a persisted group, does `_boot()` +
`await this.base.ready()` + `await this.blobs.ready()` +
`await this._startSwarm()` before it resolves — *before* wiring up
`bridge-main`'s request handler (`createBridgeMain(...).start()`, which
calls `transport.onMessage(...)` to register the handler that answers
`'req'` messages). `_layout.js` fires `bridge.call('getState')`
immediately on mount, with no wait for a `'ready'` evt first. The
transport (`bridge/transport/duplex-json.js`) has no queueing — a
message that arrives before any handler recognizes it is simply
dropped, matched against whatever's in the handler list *at delivery
time*. If the RN side's `getState` request lands before `core.ready()`'s
resume finishes (plausible: swarm bootstrap is a real network op), that
request is silently lost — its promise never resolves, so `_layout.js`'s
`.then()` never dispatches, and the initial snapshot stays `groupStatus:
'none'`. Nothing else naturally re-pushes state afterward unless some
external event fires (a new roster change, a new send) — a resumed
autobase that's already fully caught up doesn't emit `'update'` on its
own.

**Why this is out of scope for Task 6**: it's a Task 1/4 wiring gap
(bridge-main's request handling vs. `worklet-client.js`'s unconditional
immediate `getState` call), not anything in the apply-controller or
native module this task added. `pm clear`-ing between every fresh QA
attempt (the normal pattern, followed in Acts 1-2 and everywhere else in
Act 3) never resumes a persisted group, so the race is never hit in the
documented happy paths above — it only surfaced because this session's
own debugging repeatedly relaunched an app that already had
Act-3-created group state on disk. Flagged here and in
`docs/notes/api-divergences.md` for a follow-up task; not fixed.

### Happy path — fresh pair, send, visible apply

Fully clean run (`pm clear` first): scripted peer creates a group,
mints an invite; invite pasted into the emulator's `Onboarding`, "Join a
group" tapped; peer's `pairing-request` handler approves immediately.
Peer log, in order: `roster-changed` (creator alone), `pairing-request`
from `sdk_gphone64_arm64`, `roster-changed` (both devices, joiner
`online: true`), then automatically (per the script) `sendWallpaper()`
targeting the joiner's key:

```
SENT id= c67356a9a82460f5fe90f7f52ca11f19
send status: pending
send-updated c67356a9a82460f5fe90f7f52ca11f19
send status: delivered
DELIVERED — ack round-tripped
```

`FINAL listSends()` confirmed the single target's status as
`"delivered"` — the `markApplied` ack genuinely round-tripped back to the
sender, not just a local "we think it worked" on the phone.

**Visible wallpaper change**: `adb shell input keyevent KEYCODE_HOME`
immediately after, then `adb exec-out screencap -p`. Before
(`.superpowers/sdd/2026-08-23-android-shell/task-6-home-wallpaper-before.png`):
the emulator's stock light blue/white gradient wallpaper. After
(`.../task-6-home-wallpaper-after.png`): the entire home screen — behind
the clock, the app icons, the search bar — is now the solid bright
magenta test image, an unambiguous, unmissable change. This is the
milestone: a desktop peer's `sendWallpaper()` call visibly changed the
Android home screen's actual system wallpaper via `WallpaperManager`.

### Cleanup

Same as Acts 1-2: `pm clear` between attempts, scripted peer processes
killed, throwaway `desktop/qa-peer-tmp.js` / `desktop/qa-control-tmp.js`
/ `scratchpad/gen-png.js` deleted or left outside the repo (`git status`
clean before commit — confirmed). Temporary `[QA-DEBUG]` `console.log`
lines added mid-session for the permission-bug investigation were all
reverted before commit.

`npm run test:ui`: 26/26. `npm run test:worklet`: unchanged, 2/2 tests,
8/8 asserts.
