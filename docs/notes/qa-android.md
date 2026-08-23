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
