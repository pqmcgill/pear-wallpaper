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

## Act 4 — Main UI: device list, invites, received history, settings (2026-08-23)

New this Act: `components/{DeviceList,Received,Settings}.js` (real tabs
replacing Task 4's placeholder), `lib/qr.js` (`@paulmillr/qr` + a
react-native-svg-specific post-process, see bug #2 below), `lib/settings.js`
(`expo-file-system`-backed `{ lockScreen }` persistence, `getTarget()` wired
into Task 6's `createApplyController` in `_layout.js`). `react-native-svg`
added via `npx expo install` (native module) — full rebuild required:
`npx expo prebuild --platform android --clean` then `npm run android`,
same as Task 6's `SET_WALLPAPER` permission lesson (`android/android/`
already existed from prior tasks, so a plain rebuild would have skipped
re-reading `app.json`). `npm run test:ui`: 41/41 (38 carried + 3 new
`qr.test.js` cases). `npm run test:worklet`: unchanged, 2/2 tests, 8/8
asserts.

### Bug found + fixed #1: MainView's nav row rendered underneath the status bar

**Symptom**: on the very first cold-start screencap of the new tabbed
`MainView`, "Devices"/"Settings" showed faint overlapping glyphs (status
bar clock digits and signal/battery icons bleeding through the nav text —
confirmed by cropping and 2x-upscaling the top strip,
`task-7-nav-statusbar-bug-crop.png`). More than cosmetic: taps landing in
that overlapped band **never reached the Pressables at all** — every
"Received"/"Settings" tap silently no-opped (confirmed two ways: repeated
`uiautomator dump` after a tap in-bounds showed the Devices tab's content
unchanged, and a temporary `console.log` in each `onPress` never fired in
the Metro log).

**Root cause**: every earlier screen (`Onboarding`, `Waiting`) centers its
content well below the status bar; `MainView` was the first screen to pin
content to the very top of the window with no safe-area inset. The
translucent system status bar's touch-target area apparently takes
priority over app content drawn behind it at that y-range, so touches
there never reached RN's touch responder chain.

**Fix**: `useSafeAreaInsets()` (`react-native-safe-area-context`, already
a dependency; `expo-router`'s `ExpoRoot` wraps the tree in a
`SafeAreaProvider` already, so no extra provider setup was needed) —
`nav`'s `paddingTop` is now `insets.top + 16`. Confirmed fixed: a fresh
cold-start screencap (`task-7-nav-fixed.png`) shows the nav row clearly
below the status bar, and the same tap coordinates that previously
no-opped now switch tabs (`uiautomator dump` showing the target tab's
content after each tap).

### Bug found + fixed #2: the invite QR pegged the UI thread for seconds per frame

**Symptom**: while investigating bug #1, `adb logcat`'s `EGL_emulation
app_time_stats` showed per-frame times up to **~24 seconds** while an
invite QR was on screen, and the whole Devices tab (nav included) was
unresponsive to touch for that entire window — this compounded bug #1's
symptoms and made the two easy to conflate at first.

**Root cause**: `@paulmillr/qr`'s `toSVG()` emits one `<rect>` per dark QR
module — confirmed via `node -e` against the real invite text: **1052
`<rect>` elements** for a 112-character invite string. Desktop's `qr.js`
(`desktop/ui/qr.js`) injects that string into an HTML DOM via
`dangerouslySetInnerHTML`, where a browser renders thousands of `<rect>`s
at negligible cost. `react-native-svg`'s `SvgXml` instead creates one
*native* view per SVG element — confirmed via `adb shell uiautomator
dump`, which showed **1052 `com.horcrux.svg.RectView` native views** in
the hierarchy for the same invite. Inflating/laying out/rendering that
many native views per frame is what produced the multi-second frame
times.

**Fix**: `android/lib/qr.js` calls the exact same `encodeQR(text, 'svg')`
as desktop, then merges every `<rect>` into a single `<path>` (one `M x y
h1v1h-1z` subpath per dark module — visually identical, one native
`PathView` instead of a thousand `RectView`s). Desktop's `qr.js` is
untouched; this post-process is Android-only, motivated purely by
`SvgXml`'s one-native-view-per-element cost, not a change to the
`@paulmillr/qr` call or the function's public contract. Regression
coverage in `test/qr.test.js` (single `<path>`, zero `<rect>`s, identical
module coordinates, unchanged `viewBox`). Confirmed fixed on-device: the
same invite QR now renders instantly (screencap `task-7-invite-and-qr.png`
taken immediately after the "New invite" tap, no perceptible delay), and
nav taps taken moments later registered normally.

### Main navigation + Android-created invite (partial — see finding below)

With both bugs above fixed, full Main navigation was confirmed on-device:
`Devices` (roster + creator-only invite/candidate controls),
`Received` (empty-state and populated, see below), `Settings` (device
name/key read-only, lock-screen toggle, `Last synced`, **no**
"Launch at login" control — `snapshot.loginAtLogin` is genuinely absent
on Android, confirmed by dumping the raw bridge snapshot shape in
`test/settings.test.js` and by the on-device screencap
`task-7-settings-tab.png`).

Android (as group creator) minted a real invite via "New invite"
(`task-7-invite-and-qr.png` — selectable text plus a correctly-scannable
`SvgXml` QR). A scripted desktop peer (same `pear-wallpaper-core`-direct
pattern as Acts 2-3) called `joinGroup(invite)` against it. The candidate
**did** eventually connect — Android's Devices tab rendered the expected
"qa4-desktop-peer wants to join" approval row with working Approve/Deny
(confirmed via `uiautomator dump` text content, and pressing Approve
updated the roster on Android's side to show the peer as a joined member)
— but the round trip took several minutes, and a second clean attempt
(fresh invite, fresh peer identity, ~13 minutes) never completed at all in
the time budgeted for this Act.

**Finding (flagged, not a Task 7 code bug): Android-as-admitting-member
over the emulator's NAT is slow/unreliable in this environment.** Task 5's
proven-fast topology has the emulator as the outbound-dialing *candidate*
(joining someone else's group); this scenario inverts it — the emulator is
the already-swarming *creator*, waiting for an *inbound* connection from
the scripted peer. The emulator's QEMU NAT is a plausible explanation for
that asymmetry (outbound connections are its well-trodden path; unsolicited
inbound rendezvous through it is not), though this wasn't instrumented
further — `adb logcat` has no visibility into the Bare worklet's
UDX/Hyperswarm internals, and time-boxing this investigation (per the
task's own guidance) took priority over chasing it further. Recommend a
follow-up: exercise this exact direction (Android creates, a real second
device or peer joins) against a physical device in Task 10's phase, where
there's no emulator NAT in the path.

**What's actually verified**: the DeviceList code paths this scenario
exercises — `createInvite` → text + QR render, a `candidate` event →
approval row → `approve(key)` → roster update — all worked correctly when
the connection did eventually form. The slowness/unreliability is in the
network rendezvous, not in the Android UI or bridge code added this task.

### Received reapply + lock-toggle → both home and lock (pragmatic topology)

To still exercise `Received`'s reapply and the lock-toggle's effect on a
real apply — both blocked on *some* working pairing, not specifically the
Android-creates-invite direction — this sub-Act used the reverse, Task-5-
proven-fast topology instead: a scripted peer created a group and invite
(`WallpaperCore.createGroup()`/`createInvite()`), Android pasted it via
Onboarding's paste field and tapped "Join a group" (identical mechanics to
Acts 2-3), and the peer auto-approved the resulting `pairing-request`. This
round-tripped in **seconds**, not minutes — consistent with the NAT-
asymmetry finding above. Peer log, in order: `PAIRING REQUEST` →
`ROSTER CHANGED` (joiner online) → `APPROVED` → `SENDING wallpaper` →
`SENT` → `send-updated ... status: delivered`.

1. **Auto-apply on join.** The peer's `sendWallpaper()` (a distinctive
   bright-cyan 480×480 test PNG, same synthetic-PNG technique as Task 6's
   magenta one) landed on Android; Task 6's `createApplyController`
   auto-applied it via the native setter with no manual step.
   `adb exec-out screencap -p` after `KEYCODE_HOME`
   (`task-7-home-wallpaper-cyan.png`) showed the entire home screen — icons,
   clock, search bar — now the solid cyan test image.
2. **Received tab.** Showed the delivered item: thumbnail (`Image` with a
   `file://` URI), the sender-recorded filename, and a "Re-apply" button
   (`task-7-received-tab.png`).
3. **Reapply.** Pressed "Re-apply" (target `home`, lock toggle still off at
   this point). No error banner rendered (a rejection would have shown one,
   per `test/received.test.js`'s coverage of that path) — the setter
   resolved cleanly. Same image/target, so no visual delta expected or
   looked for here; the meaningful proof is the call succeeding with
   `getTarget()` wired correctly and no bridge/`markApplied` involvement
   (structurally impossible — `Received` has no `bridge` prop at all).
4. **Lock toggle → next apply sets lock too.** Flipped "Apply to lock
   screen too" on in Settings (`task-7-lock-toggle-on.png`; confirmed
   persisted via `adb shell run-as com.pearwallpaper.app cat
   files/settings.json` → `{"lockScreen":true}`), then pressed "Re-apply"
   again. `adb shell dumpsys wallpaper` before vs. after is the clean
   before/after signal the brief asked for:
   - **Before** (home-only): two separate wallpaper records — System
     `id=4 mWhich=1 mBindSource=SET_STATIC mCropHint=Rect(0,0-480,480)`;
     Lock `id=0 mWhich=2 mBindSource=UNKNOWN mCropHint=Rect(0,0-0,0)` (never
     explicitly set — the empty crop and `id=0` show it was only ever
     falling back to System).
   - **After** (both): a single record, `id=5 mWhich=3
     mBindSource=SET_STATIC mCropHint=Rect(0,0-480,480)` — `mWhich=3` is
     `FLAG_SYSTEM(1) | FLAG_LOCK(2)`, i.e. one explicit bind covering both
     surfaces at once, exactly what `setWallpaper(filePath, 'both')`
     (`modules/wallpaper-setter`) is supposed to produce.
   - **Screencap proof**: the AVD's keyguard is disabled by default (a
     sleep/wake cycle just resumed the app, no distinct lock UI) —
     `adb shell locksettings set-disabled false` enabled it. A subsequent
     `KEYCODE_SLEEP`/`KEYCODE_WAKEUP` cycle then showed a genuine lock
     screen (clock, "Charged", swipe-up unlock affordance) with the same
     solid cyan image as its background (`task-7-lock-screen-cyan.png`) —
     visual confirmation matching the dumpsys evidence.

### Cleanup

`pm clear com.pearwallpaper.app` after the Act; all scripted-peer
processes killed; throwaway `desktop/qa4-*-tmp*.js` and `desktop/qa4-peer-
resume-tmp.js` scripts deleted (`git status` clean before commit —
confirmed, only the task's real source/test files and this doc are
tracked changes). `npm run test:ui`: 41/41. `npm run test:worklet`:
unchanged, 2/2 tests, 8/8 asserts.

## Act 5 — Share-sheet send: Android is the sender, first Android→desktop milestone (2026-08-23)

New this Act: `app/send.js` (the Send screen — image preview + per-device
`Switch` targets, ported from `desktop/ui/components/Send.js`'s selection
logic), `lib/share-target.js` (`stageSharedImage(uri)`), a share-intent hook
in `_layout.js` (`useShareIntent()` from `expo-share-intent@6.1.1` — see
`docs/notes/api-divergences.md` for the Step 1 health check that pinned this
version), and `app.json` changes: `scheme` renamed `to.holepunch.bare.expo`
→ `pearwallpaper` (the controller-folded deferred finding from Task 7;
confirmed load-bearing — `expo-share-intent`'s `getScheme()` reads
`Constants.expoConfig.scheme` to build its native-module cache-clearing key)
and the `expo-share-intent` config plugin with
`androidIntentFilters: ["image/*"]` (its default is text-only). Config
plugin changed the manifest ⇒ full `npx expo prebuild --platform android
--clean` then `npm run android`, same lesson as Tasks 6/7.
`npm run test:ui`: 47/47 (41 carried + 6 new `send-screen.test.js` cases —
4 for the Send screen's target-selection/disabled-state/error behavior, 2
for `stageSharedImage`). `npm run test:worklet`: unchanged, 2/2 tests, 8/8
asserts.

For this milestone the **Android device is the sender** and the **peer is
the receiver** — the reverse of every prior Act. Topology: a scripted
desktop-stand-in peer (`desktop/qa8-peer-tmp.js`, throwaway, deleted before
commit — same real-`WallpaperCore` pattern as every prior Act's scripted
peer) creates the group and invite (Task 7's proven-fast direction: peer
creates, emulator joins); the emulator pastes the invite via `Onboarding`
and joins in seconds. The peer then just listens for the `'wallpaper'`
event — this Act's actual subject is entirely on the Android side.

### Setup

```bash
# Terminal A — scripted desktop peer (creator; real WallpaperCore, listens
# for the 'wallpaper' event once the phone shares)
cd desktop && node qa8-peer-tmp.js

# Terminal B — emulator, same env exports as every prior Act
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
adb shell pm clear com.pearwallpaper.app
adb shell am start -n com.pearwallpaper.app/.MainActivity
# ...paste the printed invite into Onboarding, tap "Join a group" (Act 2's
# mechanics) — roster shows the peer within seconds.
```

Test image: a distinctive 480×480 solid bright-lime-green PNG
(`scratchpad/t8-gen-png.js`, throwaway, hand-built raw-PNG-chunks technique
identical to Task 6's magenta one), pushed to the emulator's Downloads and
media-scanned so it appears as a real gallery image with a `content://` URI:

```bash
adb push t8-qa-wallpaper.png /sdcard/Download/t8-qa-wallpaper.png
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Download/t8-qa-wallpaper.png
adb shell content query --uri content://media/external/images/media \
  --projection _id:_display_name:_data   # confirms the row + real _id
```

### adb-vs-UI path used, and why

**Used the adb-direct-intent path** (`am start -a android.intent.action.SEND
-t image/png --eu android.intent.extra.STREAM content://.../<id>
-c android.intent.category.DEFAULT --grant-read-uri-permission`, **no**
`-n <component>`), for a deliberate reason beyond "UI-driving proved
flaky": this project's stock AVD has Google Photos installed but no
usable local-file gallery/Files-app share flow that's scriptable without
either a Google account sign-in (Photos) or blind multi-screen navigation
through `documentsui` with unknown layouts per Android version. Omitting
`-n` means the intent is **implicit** — Android resolves it through the
real system `ResolverActivity` (the actual share sheet), so this still
exercises the real manifest intent-filter matching, not a fast-path
bypass straight into the app. Confirmed live: the resulting sheet listed
**"Pear Wallpaper"** (with its real launcher icon) as the top entry,
alongside Maps/Bluetooth/Gmail — proof the `expo-share-intent` config
plugin's manifest intent-filter (`action.SEND` + `image/*`) is correctly
registered and Android's package manager genuinely offers this app for
image shares, not just that the app can handle an intent aimed
directly at it. Screenshots: `scratchpad/t8-3b-sheet.png` (chooser with
Pear Wallpaper listed), `scratchpad/t8-9-cold-sheet.png` (the cold-start
sheet, showing Android's "Share with Pear Wallpaper" quick-repeat banner
from the prior "Just once" choice).

**adb coordinate gotcha (recorded in Act 2, hit again here):** screenshots
read back into this session render at 900×2000 for a real 1080×2400
device — every tap coordinate below is the *real* (×1.2) value, not the
screenshot's displayed pixel. Mis-scaling once mid-session (tapping the
sheet's "Just once" button at the screenshot's raw pixel value) landed on
the "Maps" row instead and had to be recovered by re-selecting "Pear
Wallpaper" and retrying with the corrected coordinate — same trap, same
fix as Act 2.

### Warm start — app already running, share arrives while backgrounded

1. Fired the SEND intent (above) while the app sat on `MainView`'s
   Devices tab (backgrounded, not killed).
2. Tapped "Pear Wallpaper" in the resulting share sheet, then "Just once".
3. App foregrounded straight onto the **Send screen** — no manual
   navigation, no flash of `MainView` first: `_layout.js`'s
   `useShareIntent()` effect had already staged the file and called
   `router.replace('/send', ...)` by the time the screen painted.
   Screenshot `scratchpad/t8-4-send-screen.png`: the lime-green preview
   image rendered correctly (proof `stageSharedImage()`'s
   `content://`→real-file copy succeeded and the resulting path is
   readable by RN's `Image`), plus a `qa8-desktop` row with an off
   `Switch` and a `Send` button.
4. Toggled the switch on (`scratchpad/t8-7-toggled.png`), pressed Send.
5. App navigated back to `MainView`'s Devices tab immediately (Send's
   `onSent` → `router.replace('/')`), no error banner.
6. Peer log (`scratchpad/t8-peer.log`):
   ```
   === WALLPAPER EVENT ===
   { id: '76e0b17c5c8ca7c5b616175c8493a2d2',
     filePath: '.../received/76e0b17c5c8ca7c5b616175c8493a2d2.png',
     fromKey: 'b13ec8950d1f31b9db76cd77af8afd18dc941603b58f7ef99bcf933280c73e2d',
     meta: { ext: '.png', byteLength: 1769,
       filename: '/data/user/0/com.pearwallpaper.app/files/pear-wallpaper-staging/1787510856238.png' } }
   materialized file byteLength= 1769
   ```
   The `meta.filename` confirms the exact staging path
   (`<documents>/pear-wallpaper-staging/<timestamp>.png`) `share-
   target.js` is specified to produce. **Byte-exact verification**:
   `md5` of the peer's materialized file and the original
   `t8-qa-wallpaper.png` both `cc8f1321ba2519222f356ae90ae91979` — the
   image that crossed the OS share sheet, the staging copy, hyperblobs,
   and the desktop peer's materialize step is bit-for-bit the same file.

### Cold start — app fully killed, share relaunches it straight to Send

1. `adb shell am force-stop com.pearwallpaper.app`; confirmed with
   `adb shell dumpsys activity activities | grep pearwallpaper` (no
   output — no task, no process).
2. Pushed a second, distinct test image (480×480 bright orange,
   `scratchpad/t8-gen-png2.js`) and media-scanned it, so this send is
   provably a different transfer from the warm-start one.
3. Fired the same implicit SEND intent at the *fully-stopped* app.
   Android's chooser this time showed a **"Share with Pear Wallpaper"**
   quick-repeat header (remembering the prior "Just once" choice) —
   tapped "Just once" again (`scratchpad/t8-9-cold-sheet.png`).
4. `adb shell dumpsys activity activities` immediately after showed a
   **new** task (`Task{... #37 ...}`) with `MainActivity` as
   `topResumedActivity` — a genuine cold process start, not a resumed
   background one.
5. The app launched straight onto the **Send screen** with the orange
   preview and the roster already populated (`scratchpad/t8-10-cold-
   landed.png`) — no flash of `Onboarding`/`MainView` first, and no
   error. This is the two-part proof the brief asked for:
   `getBridge()`'s queue-until-ready gate (Task 6's fix) absorbed the
   worklet not being started yet — the roster row rendered correctly
   once `getState` replayed after `'ready'` — and `expo-share-
   intent@6.1.1`'s Android path (which queries the native module's held
   intent state unconditionally on mount, not via deep-link URL parsing)
   delivered `hasShareIntent: true` in time for `_layout.js`'s very first
   effect run, with no `+native-intent.ts` needed (see
   `docs/notes/api-divergences.md`'s Step 1 write-up for why Android
   doesn't need it here).
6. Toggled the target switch, pressed Send. Peer log:
   ```
   === WALLPAPER EVENT ===
   { id: '95fe5206b0a93659b425b4b3561d9cd6', ...,
     meta: { ext: '.png', byteLength: 1826,
       filename: '.../pear-wallpaper-staging/1787510958028.png' } }
   ```
   **Byte-exact verification**: `md5` of the peer's materialized file and
   `t8-qa-wallpaper-cold.png` both `1640e524d443de0a517786bd0146fbf0`.
7. App navigated back to Main cleanly, same as the warm-start case.
   `adb logcat -d | grep -iE "pearwallpaper.*(error|exception|fatal|crash)"`
   (excluding the known-benign `ReactNoCrashSoftException`) — no hits
   across the whole Act.

### Cleanup

`adb shell pm clear com.pearwallpaper.app`; scripted peer process killed;
`desktop/qa8-peer-tmp.js` deleted (`git status` clean before commit —
confirmed, only this task's real source/test files and this doc are
tracked changes). `npm run test:ui`: 47/47. `npm run test:worklet`:
unchanged, 2/2 tests, 8/8 asserts.

## Act 6 — Background sync: opportunistic apply while backgrounded/killed (2026-08-23)

Task 9. See `docs/notes/headless-worklet-spike.md` for the mandatory
spike (verdict: PASS) that ran before any of `lib/background-sync.js` was
written. This Act QAs the real implementation, registered as task
`pear-wallpaper-sync` (`app/_layout.js`, module scope) with
`BackgroundTask.registerTaskAsync(..., { minimumInterval: 15 })`.

Setup: scripted desktop peer (`desktop/qa9-peer-tmp.js`, same shape as
Task 6/8's scripted peers) created a group, printed an invite, and waited
on trigger files so each of its three sends could be timed against a
specific phone state. Joined from the emulator via paste-invite (same
flow as prior Acts). Three distinct 320×320 PNGs (red/green/blue,
`scratchpad/t9-wallpaper-{a,b,c}.png`) so each transfer is unambiguous
both visually and by hash.

### (a) Backgrounded, process alive — the "nudge" path

`adb shell input keyevent KEYCODE_HOME`, then the peer sent wallpaper A
(red) to the still-online device. Forced the job
(`adb shell cmd jobscheduler run -f com.pearwallpaper.app <jobId>`, id
read from `adb shell dumpsys jobscheduler`). logcat:
```
BackgroundTaskConsumer: Executing task 'pear-wallpaper-sync'
ReactNativeJS: '[background-sync]', 'nudged-resident'
```
`adb shell dumpsys wallpaper` before/after: `id=5` → `id=6` (new
`SET_STATIC` record). `adb exec-out screencap -p` after `KEYCODE_HOME`
(`t9-5-backgrounded-red.png`): the entire home screen is solid red.
**This is the single-writer guard's real proof**: `isActive()` saw the
resident worklet EXIST (it was long past `'ready'` by this point, but
existence — not readiness — is what `isActive()` actually checks, a
correction made in review: gating on readiness would leave a window
during a resident worklet's own bootstrap where a background round could
construct a second `Worklet` on the same `storageDir`) and
`runBoundedSyncRound()` took the nudge branch — `bridge.call('syncNow')`
+ `applyPending()` on the *existing* bridge, never `new Worklet()`.
Repeated later with wallpaper C (blue) for a second data point: same
`'nudged-resident'` log, `id=6` → `id=7`, screenshot
`t9-8-blue-guard-confirm.png` solid blue — reproducible. **Both real-device
data points exercised the resident worklet already fully ready**, not the
mid-bootstrap race the review fix specifically targets — that narrower
case is covered only by `worklet-client.test.js`'s existence-based unit
tests, not by this Act.

### (b) Killed via `am kill` (background kill, not force-stop)

`adb shell am kill com.pearwallpaper.app` (confirmed dead: `pidof` exit
1). Peer sent wallpaper B (green) — `roster-changed` showed the device
`online: false`, so this queued in the replicated log rather than
delivering live. Forced the job: the OS **did** respawn the process (new
pid) to service it — a real, meaningful difference from force-stop — but
`adb shell dumpsys activity processes` showed it hit `isFrozen=true`
before React Native's JS ever logged `"Running main"`, both times this
was tried. No `background-sync` log line, no wallpaper change
(`dumpsys wallpaper` unchanged). This is an honest negative result, not an
implementation bug — same freeze-before-JS-boot behavior the spike
documented, plausibly worse on this debug build (JS fetched from Metro
over the network on every cold boot vs. embedded in a release APK).
**Recovery**: `adb shell am start` on the same task brought the frozen
process to the foreground, which unfroze it — RN finished booting,
`_layout.js`'s normal mount-time `getState`/`applyPending` path (the
*guaranteed* path, not background-sync) drained the queued wallpaper B
immediately. Screenshot `t9-7-appopen-recovered-green.png`: solid green.
Exactly the spec's framing — background is opportunistic, sync-on-open is
guaranteed — demonstrated end to end, not just asserted.

Force-stop, for contrast: `adb shell am force-stop`, then
`dumpsys jobscheduler` showed **zero** jobs for the app immediately
(force-stop cancels them), and forcing failed outright
(`Could not find job 0 in package com.pearwallpaper.app`) — the
documented-and-accepted Android behavior, confirmed rather than assumed.

### Guard check with the app genuinely foregrounded

Brought the app to the foreground, forced the job again. **Divergence
from the brief's literal expectation**: no `nudged-resident` (or any
`background-sync`) log appears at all — `BackgroundTaskScheduler.kt`'s
`runTasks()` checks `inForeground` (toggled by
`OnActivityEntersForeground`/`Background`) *before* invoking any task
consumer, for both forcing methods (`triggerTaskWorkerForTestingAsync`
and `adb ... run -f` are the same call underneath — confirmed by reading
`BackgroundTaskModule.kt`). logcat instead shows only:
```
BackgroundTaskScheduler: runTasks: App is in the foreground
BackgroundTaskScheduler: Enqueuing worker ... '15' minutes delay.
```
So "no second worklet while foregrounded" is structurally guaranteed —
our task body never runs at all in that state, by the library's own
design, not by our guard. The guard our code owns (`isActive()`) is
instead proven by (a) above (real device, `nudged-resident`, zero new
`Worklet` instances) and by `background-sync.test.js`'s guard test
(`__instances` stays empty).

### What this Act did NOT prove

Stated plainly rather than buried: **every scenario in this Act that
actually completed a background round took the `nudged-resident` branch**
— the resident worklet was always present in-process. The one scenario
built to exercise the *other* branch — `runBoundedSyncRound()` spinning up
a fresh `Worklet` (the `'synced'` return value, the actual new production
machinery Task 9 adds) — is (b) above, and it froze before RN JS finished
booting, so `runBoundedSyncRound()` was never even invoked there. **The
fresh-Worklet branch has zero on-device evidence from this Act.** What
backs it instead: the Step 1 spike (a headless task body starting a
Worklet with a trivial inline echo, not the real bundle/init/syncNow/
applyPending/shutdown sequence) and `background-sync.test.js`'s unit
tests (the full real sequence, but against a mocked IPC, not a real
corestore or real Android process). Both are real signals, but neither is
"the fresh round completed for real on a killed-and-respawned device,"
which this Act could not establish on this emulator/debug-build
combination.

**Physical-device follow-up needed**: re-run scenario (b) on a physical
device (or a release build, which skips the Metro-fetch cold-boot path)
to see whether the process can get past the freeze in time to actually
run `runBoundedSyncRound()`'s fresh-Worklet branch end to end.

### Byte-exact verification

Pulled all three received files via `adb shell run-as com.pearwallpaper.app
cat files/pear-wallpaper/received/<id>.png`; `md5` of each matched its
source PNG exactly (`149c4e3a...`, `4d266894...`, `8bffa2a0...`). The
peer's final `listSends()` showed all three targets `"delivered"` —
including wallpaper B, whose ack only round-tripped after the app
reopened and synced.

### Cleanup

`adb shell pm clear com.pearwallpaper.app`; peer process killed;
`desktop/qa9-peer-tmp.js` deleted; scratchpad PNGs/screenshots left
outside the repo (`git status` clean before commit — confirmed, only
Task 9's real source/test files and docs are tracked changes). `npm run
test:ui`: 57/57 (54 carried + 3 new `background-sync.test.js` cases).
`npm run test:worklet`: unchanged, 2/2 tests, 8/8 asserts.

## Act 7 — Lifecycle: a send landing mid-suspend, and the linger boundary (2026-08-23)

Task 10. Targets `app/_layout.js`'s `AppState.addEventListener('change', ...)`
handler (Task 4): `'background'` calls `getWorklet()?.suspend(30000)`;
`'active'` calls `getWorklet()?.resume()` then `bridge.call('syncNow')`.
This Act asks two things: (1) does a send that arrives while the app is
backgrounded actually survive to be applied once the app is foregrounded
again, and (2) does the 30000ms linger need tuning — is it long enough,
and is there a cliff at/after the boundary (e.g. `resume()` on an
already-terminated `Worklet` throwing uncaught, per
`react-native-bare-kit`'s `index.js`: `resume()`/`suspend()` both
`throw new Error('Worklet has been terminated')` if the native side has
already invoked the JS-bound `terminate` callback for that instance).

Setup: scripted desktop peer (`desktop/qa10-peer-act7.js`, deleted after —
same shape as prior Acts' peers, `pear-wallpaper-core` required from
`desktop/node_modules`'s symlink) created a group and printed an invite;
joined from a freshly-cleared emulator via paste-invite. The peer waits on
a trigger file before calling `sendWallpaper`, so the send can be timed
precisely against the phone's AppState.

### (a) Send lands mid-suspend, foregrounded well inside the 30s window

1. `adb shell input keyevent KEYCODE_HOME` — app backgrounds,
   `suspend(30000)` fires.
2. ~3s later, touched the peer's trigger file. Peer's `listSends()` polling
   showed the target immediately, and stayed, at `status: "pending"` —
   confirms the send genuinely lands while the phone is suspended, not
   applied live (the JS event loop isn't running to process it). Notably
   the peer's roster still reported the phone `online: true` throughout —
   the underlying swarm TCP connection is not torn down by `suspend()`,
   only the Bare JS thread is paused; bytes queue at the OS/socket level
   for whenever the isolate resumes.
3. ~15s further (about 18s of total background time, well inside the 30s
   linger), `adb shell am start -n com.pearwallpaper.app/.MainActivity`
   brought the app to the foreground. `AppState` fired `'active'`:
   `getWorklet().resume()` succeeded (no throw), `bridge.call('syncNow')`
   ran `core.sync()` against the still-open connection.
4. Peer's log went `pending` → `delivered` within the next poll tick;
   `adb shell dumpsys wallpaper`'s record id advanced (`id=5` → `id=10`,
   `mWhich=1` — home screen). MainView screenshot
   (`act7-3-after-resume.png`) confirmed the app came back on the roster
   screen with no `ErrorBanner`. One `ReactNativeJS` warning appeared in
   logcat at the same timestamp (`Cannot connect to Expo CLI` /
   `Error: undefined`) — this is the stock RN dev-build banner for "no
   Metro dev-server reachable" (none was running this session; the app's
   JS still ran from whatever was already loaded), unrelated to the
   worklet/lifecycle code path — confirmed by checking the message text
   against React Native's own dev-menu source, not assumed.

**This is the milestone**: a real send, queued on the wire while the
device was suspended (not killed — see Act 6/Task 9 for that harsher
case), was drained and applied purely by the resume-triggered `syncNow()`
path, with no background-task machinery involved at all.

### (b) Past the 30s linger boundary — does anything break?

Backgrounded again, this time left alone for **35s** (past the linger) before
foregrounding. `adb logcat -c` beforehand, `-d` after, filtered for
`ReactNativeJS|worklet|fatal|exception|error`: **no matching lines at
all** — no crash, no uncaught `Worklet has been terminated` throw, no
`[worklet] init failed`. The app came back on `MainView` normally
(`act7-4-past-linger-resume.png`). To confirm the resident worklet was
still genuinely functional (not just that the RN shell survived while the
bridge underneath was silently dead), sent a second, distinct wallpaper
(purple) from a **freshly-spawned** peer process pointed at the same
`storageDir` (the original peer had been killed) while the app sat in the
foreground: it round-tripped normally — `listSends()` went
`pending` → `delivered` within ~20s (that latency is the new peer
process's own DHT/swarm rediscovery, not anything worklet-side) — and the
purple wallpaper was visible on the real home screen after backgrounding
again to look (`act7-6-home-purple-check.png`).

**Assessment: the 30s linger does not need tuning, on this evidence.**
Both a send that arrives well inside the window (18s in) and a
resume attempted past the window (35s of total background time) worked
identically from the app's perspective — no truncated sync, no crash, no
dropped connection requiring a fresh pairing. Two explanations are
consistent with this: either (a) this build/version of
`react-native-bare-kit` on Android does not actually auto-terminate the
underlying worklet purely on a wall-clock linger expiry while the hosting
process itself stays alive and un-throttled by the OS (the "linger" may
be better understood as advisory input to the *native* suspend
mechanism rather than a hard JS-visible timeout — nothing in the
installed package's JS source or README documents which), or (b) it does
terminate, but `getWorklet()?.resume()`'s optional-chaining plus
`bridge.call()`'s own queuing happened to paper over it without visible
symptoms in this exact scenario. Either way, **no evidence of breakage
was found empirically** at 18s or 35s of background time on the emulator.
**Not tested**: real OS memory pressure reclaiming the process entirely
while backgrounded (a harsher case than either suspend scenario here) —
that is Task 9/Act 6's killed-app scenario, already documented separately
as freezing before RN JS boots, independent of this linger question.
A physical device under real memory pressure (many other apps open,
low-RAM device) could still behave differently than this idle emulator;
noted on the pending-human checklist below.

### Cleanup

`adb shell pm clear` was deferred to the start of Act 8 (same group/pairing
reused to avoid re-pairing from scratch); scripted peer processes killed;
`desktop/qa10-peer-act7.js` and the ad hoc second-send script deleted
before commit.

## Act 8 — Revoke: the creator removes the device (2026-08-23)

Task 10. `core.removeDevice(key)` ([`core/index.js`](../../core/index.js))
appends a `remove-device` op (creator-only, checked against the group's
`creator` record) and, in the same call, destroys any currently-open
connection to that device (`const conn = this._connections.get(swarmKey);
if (conn) conn.destroy()`). The applied op deletes the device's roster
record (`view.del(k.device(key))`) and calls `base.removeWriter(...)`.
Critically: **`core.groupStatus` is derived purely from `this.base !==
null`** — it has no dependency on whether the device's own key is still
present in the roster — so there is no code path anywhere that flips a
removed device's `groupStatus` away from `'member'`.

Setup: reused Act 7's paired group (Android already joined, both
processes still holding the same `storageDir`s). A fresh Node process
(`desktop/qa10-act8-revoke.js`, deleted after) re-opened the creator's
`storageDir` (not `createGroup()` again — the same persisted group/local
writer identity) and called `removeDevice(androidKey)`. By this point the
old peer-to-phone connection from Act 7 had already closed (the peer
process that made it had exited), so `removeDevice`'s own `conn.destroy()`
was a no-op — the append itself is what mattered. `listDevices()`
immediately after showed only the creator: the removal is durable and
local-first, with no dependency on the removed device ever being told.

### What Android's UI shows after being revoked

Foregrounded the (already-paired, revoked) app twice — once via a plain
`am start` and once via a full `HOME` → wait → `am start` cycle (the
latter to force the `AppState` `'active'` → `resume()` + `syncNow()`
path, i.e. a genuine reconnection attempt against the swarm key the app
already knows, which is now gated out by `_isRostered` returning false
with no pairing invite outstanding). Both times:

- **No crash, no hang, no infinite spinner.** `adb logcat -d` filtered for
  `ReactNativeJS|worklet|error` showed nothing at all — not even the
  ordinary sync round produces log output on this build, so "silence" is
  the expected steady state, not evidence either way about the
  reconnection attempt's outcome.
- **The Devices tab still lists the creator as a legitimate fellow
  member** (`qa-desktop-act7 · creator`), with a gray/offline dot — visually
  indistinguishable from an ordinary "creator is temporarily unreachable"
  state (`act8-2-after-sync-attempt.png`). This is expected given the
  code: Android's own cached view was never updated (the `remove-device`
  op never reached it — see below), so its `listDevices()` still reflects
  the pre-revocation roster.
- **No `ErrorBanner`, no distinct copy anywhere.** `core/index.js`'s
  `_onConnection` only `emit('roster-changed')` inside the `allowed`
  branch of the gate check — a rejected connection is destroyed via the
  `!allowed` early return with **no event emitted at all**, so nothing
  ever reaches `bridge-main`'s `pushEvent('error', ...)` /
  `dispatch({ type: 'error', ... })` / `ErrorBanner` chain.
  `lib/store.js`'s `reduce`'s `'error'` case is simply never invoked for
  this scenario. Confirmed independently from the creator's side too: the
  revoke script's `core.on('roster-changed', ...)` listener never fired
  during either of Android's two reconnection windows — a rejected
  connection attempt (if the DHT even routed one through in that window)
  leaves no trace on either end.

**Finding, reported rather than fixed** (per this task's controller
ruling): **the UI does not surface revocation as a distinct state.** A
revoked device experiences exactly the same thing a device would
experience if the creator were merely offline — same gray dot, same
absence of any banner or message, same permanently-`'member'`
`groupStatus`, forever. There is no code path, on Android or on desktop
(the underlying behavior is identical — see `docs/notes/qa-desktop.md`
Act 12, which documents the same "online dot goes stale" symptom without
a distinct revoked-state message either), that ever tells a revoked
device "you have been removed from this group." The task's acceptance
bar asked whether the UI "states it rather than spinning" — the honest
answer is **neither**: it doesn't spin (no hang, no infinite loading
state), but it also doesn't state anything — it just looks like ordinary,
recoverable offline. Whether this is acceptable (revocation as a
low-signal, eventually-consistent lockout is arguably fine for this
app's threat model — the point of revocation is capability removal, not
notifying the ex-member) or a UX gap worth a follow-up task is a product
call, left for that ruling rather than fixed silently here.

### Cleanup

`adb shell pm clear com.pearwallpaper.app`; both scripted Node processes
killed; `desktop/qa10-peer-act7.js`, `desktop/qa10-act7-send2.js`, and
`desktop/qa10-act8-revoke.js` deleted before commit (`git status`
confirmed clean — only this task's real doc/README changes tracked).

## Act 9 — Release build, on the emulator (2026-08-23)

**Controller ruling for this session**: no physical Android device was
available (Patrick away). The brief's original Act 9 (sideload to real
hardware over LTE) is deferred to the pending-human checklist below.
Instead, this Act runs the release **variant** on the same emulator used
for every prior Act, as a meaningful stand-in: release bundles are
AOT/Hermes-compiled and load their JS from an embedded asset rather than
Metro, which is the actual mechanism most likely to break something that
only worked by accident under debug (Bare/hypercore code executing under
a different JS engine configuration is the classic failure mode named in
the ruling).

```bash
cd android
npm run bundle:worklet
npx expo run:android --variant release
```

Build: `BUILD SUCCESSFUL in 3m 7s` (544 tasks: 404 executed, 98 from
cache, 42 up-to-date) — no errors, no warnings beyond a routine Gradle-10
deprecation notice unrelated to this app's own code. Output APK:
`android/android/app/build/outputs/apk/release/app-release.apk`. Signing
uses the generated debug keystore (`android/app/build.gradle`'s `release`
signingConfig points at `signingConfigs.debug` — see `android/README.md`
for why this matters for sideloading vs. real distribution).
`enableMinifyInReleaseBuilds` is unset (defaults `false`) in this
checkout, so this pass does **not** exercise R8/ProGuard code shrinking —
noted honestly rather than claimed; it does exercise the embedded-bundle
+ Hermes-bytecode path, which is the release-vs-debug divergence that
actually touches how the worklet's bundled JS gets loaded and run.

`expo run:android`'s own post-build step logged `Waiting on
http://localhost:8081` and `Opening pearwallpaper://expo-development-client/?url=...`
— initially concerning (a real release build should need no Metro
connection at all) — but this is the Expo CLI's own generic
post-install housekeeping, not something the installed APK depends on:
this project has no `expo-dev-client` dependency (`grep
expo-dev-client android/package.json` — empty), so that deep link has
nothing registered to handle it app-side, and the CLI process exited
cleanly on its own (confirmed no lingering `expo`/Metro process
afterward) rather than blocking on it.

**Boot**: `adb shell dumpsys activity activities` showed
`com.pearwallpaper.app/.MainActivity` as `topResumedActivity`;
screenshot (`act9-1-post-install-state.png`) showed a clean Onboarding
screen — critically, **no "Open debugger to view warnings" dev-build
toast** (present on every debug-build screenshot throughout this task,
e.g. `act7-2-after-join.png`) — direct visual confirmation this is
genuinely the release JS configuration, not a debug build that happened
to boot.

**Pair**: scripted desktop peer (`desktop/qa10-peer-act9.js`, deleted
after — same shape as Acts 7/8's), invite pasted in via the same
`uiautomator dump`-derived exact tap coordinates as every prior Act.
Peer log: `pairing-request` → `approve()` → roster showing both devices,
phone `online: true`. Screenshot `act9-2-after-join.png`: MainView,
`qa-desktop-act9 · creator` with a green dot, again no dev-build toast.

**Send + apply**: peer sent a distinct 320×320 green PNG. `listSends()`
went `pending` → `delivered`; `adb shell dumpsys wallpaper`'s record id
advanced (`id=12` → `id=13`, `mWhich=1`, home screen). Backgrounded the
app to see the real home screen: solid green
(`act9-3-home-green-applied.png`). `adb logcat -d` filtered for
`fatal|crash|exception` (excluding the known-benign
`ReactNoCrashSoftException`, same exclusion Act 1 used) showed **zero**
app-related hits — every match was unrelated OS/Google-service noise
(`ChimeraSrvcProxy`, `OneSearchSuggestProvider`, a `WindowManager`
`DeadObjectException` tied to the *launcher* window during the
backgrounding transition, not this app).

**Verdict: PASS.** The release build boots, pairs, syncs against a
scripted peer, and applies a wallpaper, with no release-only breakage
observed on this emulator. This does not by itself prove the harder
physical-hardware/real-NAT/minified-R8 scenarios below — those remain
genuinely pending, not claimed.

### Restoring the debug install

Per this task's contract, restored the emulator to a debug install for
whoever runs the next session:

```bash
adb install -r android/android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm clear com.pearwallpaper.app
```

A bare reinstall like this is not sufficient on its own to get a working
debug session, and that surfaced live: launching immediately after (no
Metro attached) hit RN's stock red "Unable to load script... Make sure
you're running Metro" screen (`act9-4-debug-restored.png`) — expected and
correct debug-build behavior (debug builds fetch JS from Metro rather
than embedding it), not a regression. Followed with the real dev-loop
entry point, `npm run android` (which reruns `bundle:worklet`, starts
Metro, and reinstalls/relaunches), to leave the emulator in a genuinely
working debug state rather than a merely-installed one. Confirmed
Onboarding rendered cleanly afterward with the dev-build toast visible
again (a plain debug boot, matching every earlier Act).

### Cleanup

`adb shell pm clear com.pearwallpaper.app`; peer process killed;
`desktop/qa10-peer-act9.js` deleted before commit.

## Pending — physical-device checklist (requires Patrick)

No physical Android device was available this session (Patrick away).
Everything below is genuinely untested on real hardware — **do not treat
any of it as passing** until it's actually run. Each item names the exact
commands and the result that would count as a pass.

### 0. Sideload the release APK to a physical phone

```bash
# Build (from android/, same as Act 9 above):
npm run bundle:worklet
npx expo run:android --variant release   # or reuse the APK Act 9 already built

# With the phone connected over USB (USB debugging enabled) and selected
# in `adb devices`:
adb -s <device-serial> install -r android/android/app/build/outputs/apk/release/app-release.apk
adb -s <device-serial> shell am start -n com.pearwallpaper.app/.MainActivity
```
**Expected**: installs without a signature conflict (debug-keystore
signing, same as every prior debug install on that device — if a debug
build was ever sideloaded from a *different* machine/keystore, uninstall
first). App boots to Onboarding with no crash and no dev-build toast
(confirms it's actually running the release JS, not a leftover debug
install).

### 1. Android as the admitting member (creator/approver role)

Already flagged as unreliable in prior tasks' QA
(`docs/notes/qa-android.md` Acts 1–6 always used Android as the
*joiner*, never the creator/approver, over the emulator's NAT). Re-run
with the physical phone as the group creator and a desktop (or a second
phone) as the joiner:

1. On the phone: "Create a group" → "New invite".
2. On the other device: paste/scan the invite, "Join a group".
3. On the phone: approve the resulting candidate.

**Expected**: the same roster-sync happens as every joiner-side Act in
this doc, just with the roles reversed — the phone's `pairing-request`
event fires, `approve()` succeeds, both sides show a 2-device roster with
the other party `online: true`. **Known risk**: the emulator's NAT made
this role flaky in earlier sessions (undocumented root cause — plausibly
DHT/hole-punching behaving differently when the phone is the one
`swarm.join()`-ing first as a fresh group vs. joining an existing one);
a physical device on a real network may or may not reproduce that.
Record whichever happens.

### 2. Killed-app background sync — the fresh-Worklet ('synced') branch

Task 9 / Act 6 documented that **every** on-device scenario which
actually completed a background round took the `nudged-resident` branch
(resident worklet still in-process); the one scenario built to exercise
`runBoundedSyncRound()`'s fresh-`Worklet` branch (the `'synced'` return
value — the actual new machinery Task 9 added) froze before RN JS
finished booting, on the emulator's debug build. This remains the single
biggest gap in this shell's background-sync evidence.

```bash
# Pair the phone into a group with a scripted/real peer first, then:
adb shell am kill com.pearwallpaper.app   # NOT force-stop — force-stop cancels the job outright
# from the peer, send a wallpaper while the phone is "killed" (roster
# should show it offline)
adb shell dumpsys jobscheduler | grep -A3 pear-wallpaper-sync   # find <jobId>
adb shell cmd jobscheduler run -f com.pearwallpaper.app <jobId>
adb logcat -d | grep -E "BackgroundTaskConsumer|background-sync"
```
**Expected** (per the spec's own framing — opportunistic, not
guaranteed): `logcat` shows `Executing task 'pear-wallpaper-sync'`
followed by `[background-sync] synced` (not `nudged-resident` — no
resident worklet exists after a kill) and `dumpsys wallpaper`'s record id
advances *without* the app ever being foregrounded. Ideally re-run this
against the **release** build too (an embedded JS bundle skips the
Metro-fetch step that Task 9's report flagged as the plausible reason the
debug build froze before JS booted) — release may behave meaningfully
better here. **If it still freezes/fails on a real device**: that's a
genuine, reportable limitation of this approach on Android, not a bug to
chase further — the guaranteed sync-on-open path (already proven,
multiple Acts) is the actual safety net either way.

### 3. LTE / real NAT traversal (no shared LAN, no emulator's host-NAT)

```bash
# Phone on cellular data (Wi-Fi off), peer (desktop or another phone) on
# a different network entirely (e.g. home Wi-Fi, not tethered to the phone):
# pair via QR or a manually-copied invite string (no shared LAN for
# easy invite transfer — send the invite text out-of-band, e.g. via a
# messaging app on a second device)
```
**Expected**: pairing and a subsequent send-and-apply complete over the
public DHT/hole-punching path with no LAN shortcut available — this is
the one scenario in the whole project that actually exercises real NAT
traversal end to end rather than two processes on the same machine or
the emulator's host-NAT. Record connect latency; if it fails, capture
whether it's a DHT bootstrap issue or a hole-punch failure (different
follow-ups).

### 4. Spec §7 three-device e2e gate

The project's original acceptance bar
(`docs/superpowers/specs/2026-08-16-pear-wallpaper-design.md` §7):
> manual e2e checklist on real devices — pair Mac + Windows + Android,
> send every direction, sleep/queue scenario, Android background apply,
> revoke and confirm lockout.

No Windows shell exists yet (out of scope for this plan — the design doc
itself notes emulator+phone stand in for Windows until one does), so the
practical version of this gate is **Mac (real desktop app, not a
scripted peer) + physical Android phone**:

1. Pair the two (QR from desktop's `DeviceList`, scanned by the phone's
   camera — the one pairing path this whole task series has never
   actually exercised with a real display+camera; every prior Act used
   paste-invite or a scripted peer specifically because no display was
   available).
2. Send a wallpaper in both directions (Mac → phone, phone's share sheet
   → Mac) — confirm both apply/deliver.
3. Queue-while-offline: put the phone in airplane mode, send from Mac,
   confirm it queues (not delivered) on Mac's `Send`/roster UI, then
   bring the phone back online and confirm delivery completes without
   re-sending.
4. Background apply: background the phone, send from Mac, foreground the
   phone, confirm apply (this doc's Act 7 already proved this on the
   emulator — re-run once on real hardware for the full gate's sake).
5. Revoke: remove the phone from Mac's Devices tab, confirm (per this
   doc's Act 8 finding) that the phone silently goes to a permanent
   offline-looking state with no distinct "revoked" message — decide at
   that point whether that UX gap needs a follow-up task or is accepted
   as-is for this milestone.

**Expected**: every step above passes exactly as its emulator-only analog
did earlier in this document (Acts 2–8), with the QR-scan pairing path
being the one genuinely new surface (untested end to end anywhere in this
project so far).
