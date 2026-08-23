# Android Shell — Design

**Date:** 2026-08-23
**Status:** Approved design, pre-plan
**Builds on:** `2026-08-16-pear-wallpaper-design.md` (§3.3 sketched this
shell), `2026-08-19-desktop-shell-design.md` (three-tier topology this
shell mirrors), `core/README.md` (the frozen API contract, including the
Android lifecycle recipe this shell was designed against).

## 1. Goal and scope

An Android app that is a full member of a pear-wallpaper group: it
pairs via invite, receives wallpapers and applies them to the device,
and sends wallpapers from the system share sheet. Full spec §3.3
scope, staged — pairing + receive/apply is the first working
milestone; share-sheet send, background sync, and the lock-screen
toggle land as later tasks in the same plan.

**Out of scope:** Play Store packaging and any app-update story
(unlike desktop there is no pear-runtime OTA — the worklet's code
ships inside the APK); in-app image picker (share sheet is the only
send entry, per the original spec); iOS; 32-bit Android; wallpaper
garbage collection (unchanged MVP cut).

**Environment:** developed against the Android emulator, with
physical devices for release-APK QA. Patrick is fluent in RN/Expo, so
teachable units focus on the Bare/worklet layer, not RN itself.

## 2. Stack health (researched 2026-08-23)

The 2026-08-16 spec bet on `react-native-bare-kit`. After being
burned by `pear-electron`, we re-verified before building. Verdict:
**sound bet** —

- `react-native-bare-kit` 0.15.0 (Jun 2026), first-party Holepunch
  (mafintosh), ~monthly releases, 0 open issues. The native `bare-kit`
  layer underneath is more active still (v2.4.3, commits Aug 2026).
- `holepunchto/bare-expo` is a maintained first-party Expo template
  (Expo SDK 55 / RN 0.83 / React 19, updated 2026-08-18).
- The npm tarballs of `sodium-native` 5.1.0 and `udx-native` 1.21.1
  ship `.bare` prebuilds for all four Android arches (verified by
  unpacking, not just docs).
- Keet Mobile ships this exact architecture (hypercore stack in a
  bare-kit worklet under an RN UI) in production.
- Official guide: "Making a Bare Mobile Application"
  (docs.pears.com) — hyperswarm in a worklet, RPC to the RN UI.

Caveats baked into this design: everything is pre-1.0 (**pin exact
versions**; upgrades are deliberate tasks that re-test
suspend/resume); **no Expo Go** (native module ⇒ CNG/`expo
run:android`, `newArchEnabled`, `minSdkVersion 31`,
`useLegacyPackaging: true`); worklet code is an AOT `bare-pack
--linked` bundle; **background execution has no first-party story**
(§7 spike); thin community — read Holepunch source, not Stack
Overflow.

## 3. Architecture

Same three tiers as desktop, with the process boundary swapped for a
thread boundary:

```
RN UI (React, expo-router)                       ~ desktop renderer
  ⇄ bridge-ui  ⇄  BareKit.IPC transport adapters ~ preload/ipcMain relay
  ⇄ bridge-main in a Bare worklet (in-process thread) ~ Bare worker
  ⇄ pear-wallpaper-core (unchanged)
```

### 3.1 Project layout

Top-level `android/`, scaffolded from the `bare-expo` template (not
`create-expo-app` — hand-wiring bare-kit is how people hit TurboModule
autolinking failures), then trimmed:

```
android/
  app/                      # expo-router RN UI
  app/gen/                  # bare-pack output (gitignored build artifact)
  worklet/core-host.js      # Bare-side entry, analog of desktop/worker/core-host.js
  lib/transport/            # RN-side BareKit.IPC adapter (worklet side uses shared bare-ipc)
  modules/wallpaper-setter/ # local Expo Module, Kotlin (§6)
```

Dependencies: `pear-wallpaper-core` as `file:../core`;
`pear-wallpaper-bridge` as `file:../bridge` (§3.2); RN UI is React —
desktop's Preact/htm components don't port (no DOM), but their logic
does.

### 3.2 Shared bridge package (the one restructuring)

`bridge-main.js` / `bridge-ui.js` are transport-agnostic by design but
currently live inside `desktop/`. They lift to a new top-level
**`bridge/`** package (`pear-wallpaper-bridge`), together with the
newline-JSON duplex adapter `lib/transport/bare-ipc.js` (BareKit.IPC
is a streamx duplex like the desktop worker's fd-3 pipe — the adapter
should apply near-verbatim). Tests move with them. Each file keeps its
dialect (CJS main-side, ESM UI-side) behind an `exports` map. Desktop
updates its imports; the renderer's import map gains the entry, which
`desktop/test/renderer-modules.test.js` enforces automatically.

**Protocol addition — the apply-flow inversion.** On desktop the
worker runs the OS setter itself. On Android the setter is a native
module only the RN side can call. So `bridge-main` gains
`pendingWallpaper` and `markApplied` commands: worklet emits the
`wallpaper` event with a local file path → RN runs the native setter →
RN sends `markApplied` on success. Desktop simply doesn't use the new
commands. Failed applies stay unacked and retry next sync — core's
existing contract, enforced in the same place (the shell).

### 3.3 Worklet host

`android/worklet/core-host.js` mirrors the desktop worker: construct
`WallpaperCore({storageDir, deviceName})`, wire `bridge-main` to
`BareKit.IPC` via the shared adapter. Differences:

- **Config injection:** no `Bare.argv` sidecar contract. The RN side
  owns `storageDir` (app files dir via `expo-file-system`) and passes
  it at worklet startup — `worklet.start()` args if the API supports
  them, else a first `init` frame before bridge traffic. Verify
  against the real API in the first implementation task.
- **Process model:** the worklet is a thread in the app process — no
  spawn/orphan/exit concerns; lifetime is managed with
  `suspend(linger)` / `resume()` (§4).

## 4. RN UI and lifecycle

Routes mirror desktop's routing logic: **Onboarding** (create/join,
with **QR scanning** via `expo-camera` — the desktop already renders
invite QRs; a phone camera is what that display was for; paste stays
as fallback), **Waiting** (including "waiting for an existing device
to come online"), **Main** (device list, received history, settings).
State is one snapshot folded from `bridge-ui` events via a root
`useReducer`; UI is a pure function of it — desktop's exact model.

Lifecycle: cold start → start worklet with bundle + config →
`getState` → render. Foregrounded: resident and event-driven; a
`wallpaper` event triggers the RN-side apply. `AppState` transitions:
`active` → `resume()` + `syncNow` nudge (the `powerMonitor` resume
analog); `background` → `suspend(linger)` with the linger sized to
let an in-flight sync settle (~30s, tuned in QA). Android may kill
the process afterwards — fine: recovery is cold start + sync, and
queued delivery loses nothing.

## 5. Wallpaper setter

Local Expo Module in Kotlin (`modules/wallpaper-setter/`), ~40 lines,
owned rather than wrapped: `setWallpaper(filePath, target)` with
`target ∈ {home, lock, both}`, implemented via
`WallpaperManager.setStream()` (never materializes a full Bitmap) and
`FLAG_SYSTEM`/`FLAG_LOCK`. Manifest-only `SET_WALLPAPER` permission —
no runtime prompt. MVP sets home; the settings toggle switches
`target`. Resolves true or throws; `markApplied` only on success.

## 6. Share-sheet send

`ACTION_SEND image/*` intent filter via the **`expo-share-intent`**
config plugin (community-maintained; verify-and-pin at implementation
like every pre-1.0 dep). Share from any app → Send screen (image +
roster checkboxes, desktop `Send.js` logic) → the same
`sendWallpaper` bridge command desktop uses → worklet writes the blob
to hyperblobs and appends `set-wallpaper`; queued delivery does the
rest.

Materialization rule (the `Send.js`/`webUtils` lesson replayed):
shares arrive as `content://` URIs, unreadable by Bare's fs. The RN
side copies the image into the app files dir and hands the worklet a
real path — shells resolve platform file identity; the worklet only
sees plain paths.

## 7. Background sync

Built on **`expo-background-task`** (WorkManager-backed; its
predecessor `expo-background-fetch` is deprecated), ~15-minute
minimum interval. Opportunistic per the original spec: OEM battery
managers may suppress it, WorkManager won't resurrect a force-stopped
app, app-open sync is the guaranteed path. The task body is core's
bounded recipe run to completion headlessly: start worklet → `ready`
→ `sync({timeoutMs: 30000})` → `pendingWallpaper` → setter
(`WallpaperManager` is context-based, no Activity needed) →
`markApplied` → `close` → terminate worklet.

Hard edges:

1. **Single-writer storage.** A background worklet and a resident
   foreground worklet must never open the same corestore
   concurrently. Guard: if the app is alive with an active worklet,
   the task no-ops or nudges `syncNow` over the existing bridge.
   Verified explicitly in QA.
2. **Spike before build.** Nothing first-party documents starting a
   bare-kit worklet from a headless task invocation. It should work
   (the TurboModule lives in the RN runtime headless tasks execute
   in), but the plan's designated spike proves it — start a worklet
   headless, round-trip IPC, log — before any real background code
   exists. Fallback if the spike fails: MVP ships sync-on-open only
   (spec-blessed), with a foreground-service investigation as
   follow-up — not a redesign.

## 8. Build pipeline and distribution

- `npm run bundle:worklet` =
  `npx bare-pack --linked --host android-arm64 --host android-x64
  --out app/gen/worklet.bundle.mjs worklet/core-host.js`, chained
  ahead of `expo run:android`. `--linked` rewrites native-addon
  requires to `linked:` specifiers; `bare-link` packs the `.bare`
  prebuilds into the APK (this is what `useLegacyPackaging: true` is
  for). The bundle is gitignored.
- **Dev-loop trap (document loudly):** Metro hot-reloads only the RN
  side. Touching `worklet/`, `core/`, or `bridge/` requires a
  rebundle. This is the #1 "why isn't my change taking effect" trap.
- Exact-version pins for `react-native-bare-kit` and every Bare-side
  package; upgrades are deliberate tasks that re-test suspend/resume.
- Distribution for this plan: debug builds on the emulator; release
  APK (`expo run:android --variant release`) sideloaded to physical
  devices for cross-device QA.

## 9. Testing

**Automated (no device):** `bridge/` tests move with the package and
stay on brittle, including the shared `bare-ipc` adapter's
injected-fake-duplex tests. The RN-side adapter in
`android/lib/transport/` is tested (same fake-duplex style) under
android's jest, because it lives in the RN runtime's scope. RN-side
pure logic (snapshot reducer, routing, send-target selection) plus
components use **jest with `jest-expo`**
(+ `@testing-library/react-native`) — a deliberate divergence: one
test runner per runtime (brittle where Bare/Node runs, jest where RN
runs), not a monoculture forced across both.

**Manual:** `docs/notes/qa-android.md`, same acts format as
`qa-desktop.md`. Centerpiece: **cross-platform pairing** — desktop
displays the invite QR, the phone/emulator scans it, the two shells
meet over a real DHT. Then desktop→Android send (wallpaper visibly
changes), Android→desktop via share sheet, background apply with the
app backgrounded and killed, suspend/resume across AppState flips,
the single-writer guard, and revoke. Final milestone gate: the
original spec §7 e2e checklist across three devices (Mac + emulator +
physical phone standing in for Mac + Windows + Android until a
Windows shell exists).

## 10. Verify-points carried into the plan

Deliberately unresolved here; each is a named check inside an early
implementation task rather than a spec assumption:

1. `worklet.start()` argument-passing for config injection (§3.3) —
   args vs init frame.
2. `expo-share-intent` health at implementation time (§6).
3. Headless worklet spike (§7) — the plan's one true spike.
