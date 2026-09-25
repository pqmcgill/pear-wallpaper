# Pear Wallpaper — Android shell

Expo/React Native app that pairs into a Pear Wallpaper group and receives,
sends, and applies wallpapers on Android. Same core engine as the desktop
app (`../core`, `../bridge`); this directory is the Android-specific shell
around it. Companion docs: `../docs/notes/qa-android.md` (manual QA
script, run through Act 9 plus a pending-human checklist) and
`../docs/superpowers/specs/2026-08-23-android-shell-design.md` (the
original design spec this shell was built from).

## Architecture

Same three tiers as desktop, with the process boundary swapped for a
thread boundary — the core never runs as a separate OS process on
Android, it runs inside a Bare **worklet** (a thread hosted in this app's
own process):

```
RN UI (React, expo-router: app/, components/)        ~ desktop's renderer
  ⇄ bridge-ui                                          ~ preload/ipcMain relay
  ⇄ newline-JSON transport over react-native-bare-kit's Worklet.IPC
  ⇄ bridge-main + WallpaperCore, running inside the worklet
    (worklet/host.js, bundled by bare-pack into app/gen/worklet.bundle.mjs)
                                                        ~ desktop's Bare worker
```

`bridge-main`/`bridge-ui`/`sync-engine`/the duplex-JSON transport all live
in the shared `../bridge` package (`pear-wallpaper-bridge`) — Android and
desktop consume the exact same protocol code, only the transport adapter
and the process-vs-thread hosting differ. `lib/worklet-client.js` is the
only module that starts a Worklet, and it keeps at most one open on a
given `storageDir` (the single-writer rule): the UI claims it through
`getBridge()`, a background round leases it through `leaseWorklet()` and
hands it over instead of shutting it down if the app opened mid-round
(see its comments and `lib/background-sync.js`).

**The apply-flow inversion.** On desktop, the Bare worker runs the OS
wallpaper setter itself. On Android, `WallpaperManager` can only be
called from RN/Kotlin, not from inside the worklet's Bare thread. So the
protocol runs backwards here: the worklet surfaces a `wallpaper` event and
a `pendingWallpaper` command instead of applying anything itself;
`lib/apply-controller.js` (RN side, one controller per worklet, exposed as
the bridge handle's `applyPending()` so UI pushes and background nudges
coalesce) calls the native `setWallpaper` (via the local
`modules/wallpaper-setter/` Expo Module), and acks with `markApplied` on
success. A failed apply is simply left
unacked — core's existing retry-next-sync contract, same as desktop,
just enforced one layer further out. The failure also goes to the error
banner, as desktop's does.

## Dev loop

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
npm install
npm run android      # bundle:worklet, then expo run:android
```

**The bundle trap (read this before you spend twenty minutes confused):
Metro hot-reloads only the `app/`/`lib/`/`components/` RN-side code. Any
change under `worklet/`, `../core`, or `../bridge` does NOT take effect
until you re-run `npm run bundle:worklet`** (bare-pack regenerates the
static `app/gen/worklet.bundle.mjs` that `lib/worklet-client.js` imports
and hands to `Worklet#start`). `npm run android` always runs this first,
so a full `npm run android` is always safe; a bare Metro fast-refresh
after editing worklet/core code is not — you'll be testing the
last-bundled version and not know it. When in doubt, `npm run
bundle:worklet` again and reload.

A first-time or from-scratch device also needs the native build
(`expo run:android`) to pick up any native module changes (e.g.
`modules/wallpaper-setter/`, or a new Expo config plugin like
`expo-camera`/`expo-share-intent`/`expo-background-task`) — a JS-only
reload is not enough for those; if a native module was added or changed,
rebuild rather than reload.

### logcat recipe

The worklet only logs on the terminal-error path
(`console.error('[worklet] init failed', ...)` in `worklet/host.js`) —
there is no positive "everything's fine" log line, so absence of that
line (not presence of some other line) is the healthy signal. Useful
filters:

```bash
# App-relevant signal only, cutting the OS noise:
adb logcat -d -v time | grep -iE "ReactNativeJS|worklet|fatal|exception|error"

# Background-sync task runs specifically (Task 9's opportunistic path):
adb logcat -d | grep -E "BackgroundTaskConsumer|background-sync"

# Force a background round for testing (no-ops if the app is foregrounded —
# expo-background-task's own runTasks() checks this before invoking anything):
adb shell dumpsys jobscheduler | grep pear-wallpaper-sync   # find the job id
adb shell cmd jobscheduler run -f com.pearwallpaper.app <jobId>

# Wallpaper state, to confirm an apply actually happened (id/mWhich advance):
adb shell dumpsys wallpaper | grep -E "mWhich|Selected wallpaper"

# Corestore actually wrote to a real, writable path (storageDir sanity check):
adb shell run-as com.pearwallpaper.app ls -la files/pear-wallpaper/corestore
```

adb screenshot coordinates gotcha: a screenshot read back into a review
session is often rendered scaled down from the device's real resolution
(e.g. a 900×2000 preview of a real 1080×2400 device). Tapping at the
*preview's* pixel coordinates without correcting for that scale factor
reliably lands on the wrong element. Get exact, real-resolution element
bounds instead of eyeballing a scaled screenshot:

```bash
adb shell wm size                     # confirm the real resolution
adb shell uiautomator dump /sdcard/window_dump.xml
adb pull /sdcard/window_dump.xml /tmp/ && grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' /tmp/window_dump.xml
```

## Tests

```bash
npm run test:worklet   # brittle, worklet/host.js against a real core over an in-memory duplex
npm run test:ui        # jest + jest-expo, everything under app/ + lib/ + components/
```

Two runners because there are two runtimes in this one app: `worklet/`
and anything it requires (`../core`, `../bridge`) runs under **Bare** on
device, so its tests run under **brittle** (the same runner `../bridge`
and `../core` use) against `worklet/host.js`'s runtime-agnostic seam
(`createCoreHost({transport})` — no `BareKit`/`Bare` globals touched
there; `worklet/core-host.js` is the thin real entry that wires those
globals in). Everything under `app/`, `lib/`, `components/` runs under
**React Native**, so it's tested with **jest** + **jest-expo** +
`@testing-library/react-native`, mocking `react-native-bare-kit` where a
test needs a fake `Worklet`/IPC rather than a real Bare thread.

`test:worklet` is brittle against a real `WallpaperCore` (real
Autobase/Corestore/Hyperswarm, an in-memory duplex standing in for
`BareKit.IPC`) — small in count (2 tests, 8 asserts) but each one
exercises the real engine end to end, so it's the more failure-prone of
the two suites to keep green through Bare/core upgrades (documented in
prior tasks' reports as "brittle" in both the pejorative and literal
sense — small changes upstream tend to need small fixes here).
`test:ui` is the much larger, much more stable suite (jest, currently
59/59) covering routing, every screen's interaction logic, the apply
controller, background-sync's guard, and the worklet-client singleton's
readiness/queueing contract, all against mocks.

## Manual QA

`../docs/notes/qa-android.md` is the incrementally-written, on-device
narrative — one Act per task, from onboarding rendering through pairing,
wallpaper apply, main UI, share-sheet send, background sync, lifecycle,
and revoke, each with the actual `adb`/logcat/screenshot evidence, not
just a checklist. It ends with a release-build pass and a **pending
human checklist** — scenarios (a physical device, a real cellular
network, killed-app background sync's fresh-worklet branch, the full
spec §7 three-device e2e) that could not be exercised in an
emulator-only, no-physical-device session and are explicitly marked
PENDING rather than claimed. Read it before doing QA on this app — it
documents real gotchas (adb tap coordinates on a scaled screenshot, the
emulator's NAT making Android an unreliable admitting/creator member,
the background-task foreground no-op, etc.) that will otherwise cost you
the same hour they cost whoever hit them first.

## Pinned-versions policy

Per the project-wide rule (`../docs/superpowers/plans/2026-08-23-android-shell.md`):
**exact pins, no `^`/`~`**, for `react-native-bare-kit`, `bare-pack`, and
every Bare-side package (`b4a`, `brittle`, `test-tmp`) — these are the
packages where a minor-version drift can silently change worklet
lifecycle/suspend-resume behavior or bundle format, and an upgrade should
always be a deliberate task that re-runs the suspend/resume QA (Act 7),
never something that rides in on a routine `npm install`. Expo-managed
packages (`expo-camera`, `expo-share-intent`, `expo-background-task`,
etc.) are installed via `npx expo install <pkg>` for SDK-compatible
resolution, then pinned exact in `package.json` the same way. Every
pre-1.0 or community-maintained dependency (e.g. `expo-share-intent`) got
a health check (maintenance activity, SDK-version compatibility) recorded
in `../docs/notes/api-divergences.md` before being adopted, not just
installed and hoped for.

## Scripts

| Script | What it does |
|---|---|
| `npm run android` | `bundle:worklet`, then `expo run:android` — the normal dev-loop entry point (builds + installs + runs on a connected device/emulator) |
| `npm run ios` | `expo run:ios` (present from the template; not part of this project's supported scope) |
| `npm run start` | `expo start` — Metro alone, no native build (only useful once a compatible native build is already installed) |
| `npm run bundle:worklet` | `bare-pack --linked --host android-arm64 --host android-x64 --out app/gen/worklet.bundle.mjs worklet/core-host.js` — regenerates the AOT worklet bundle; see "the bundle trap" above |
| `npm run test:worklet` | `brittle test-worklet/*.test.js` — worklet/host.js against a real core |
| `npm run test:ui` | `jest` — everything RN-side |
| `npm run postinstall` | `patch-package` — applies any patches under `patches/` after `npm install` |

Release build (see `qa-android.md` Act 9 for the on-device pass this
produced): `npx expo run:android --variant release`. Signing uses the
generated debug keystore (`android/app/build.gradle`'s `release`
signingConfig points at `signingConfigs.debug`) — fine for QA sideloading,
**not** a production release configuration (no real keystore is checked
in or referenced). R8/ProGuard minification is **off** by default in this
checkout (`enableMinifyInReleaseBuilds` is unset in `gradle.properties`,
defaulting `false`) — a release build still exercises Hermes bytecode
compilation and the embedded (non-Metro) JS bundle path, which is the
main release-vs-debug risk surface for this app, but it does not exercise
R8 code shrinking/obfuscation of the native module glue. Turning that on
would be a deliberate follow-up task, not a QA-time flip, since R8
stripping reflection-based native module registration is a classic
source of release-only breakage that needs its own ProGuard rules and its
own QA pass.

## License

Apache-2.0 (inherited from the `holepunchto/bare-expo` template this app
was scaffolded from).
