# pear-wallpaper

Send wallpapers to your own devices, peer-to-peer. No server, no
accounts, no cloud — a private group of your devices (Mac, Android)
that replicate over the [Holepunch](https://holepunch.to) stack and
set each other's wallpapers.

Share a photo from your phone's gallery, pick a device, and it becomes
that machine's wallpaper — even if the target is asleep at the time:
delivery is queued in the group's replicated log and applied on the
target's next sync. Built as a learning project for the
Hypercore/Pear ecosystem; the docs and journal deliberately show their
work.

## How it works

Every device is a writer in an [autobase](https://github.com/holepunchto/autobase)
multi-writer log (ops: `add-device`, `remove-device`, `set-wallpaper`,
`applied`), with image bytes in [hyperblobs](https://github.com/holepunchto/hyperblobs),
peer discovery over [hyperswarm](https://github.com/holepunchto/hyperswarm)'s
DHT, and device pairing via [blind-pairing](https://github.com/holepunchto/blind-pairing)
(invite string / QR). Applying the log deterministically yields the
roster and each device's newest pending wallpaper; a target only acks
(`applied`) after its OS setter succeeds, so failed applies retry on
the next sync. Any online member replicates ops and blobs, so
delivery outlives the sender's session.

## Layout

| Directory | What it is |
|---|---|
| `core/` | The headless P2P engine (`WallpaperCore`) — all Hypercore-stack code lives here; shells only consume its API (`core/README.md`) |
| `bridge/` | Shared shell protocol: command dispatch (`bridge-main`), UI client (`bridge-ui`), sync engine, newline-JSON duplex transport — same code under Node, Bare, and React Native |
| `desktop/` | macOS shell: Electron app, core in a [Bare](https://github.com/holepunchto/bare) worker subprocess, tray-resident, `osascript` wallpaper setter, P2P OTA updates via `pear-runtime` (`desktop/README.md`) |
| `android/` | Android shell: Expo/React Native app, the same core bundle in a [bare-kit](https://github.com/holepunchto/bare-kit) worklet, QR pairing, share-sheet send target, `WallpaperManager` setter, WorkManager background sync (`android/README.md`) |
| `docs/` | Design specs, implementation plans, and `docs/notes/` — QA scripts, API-divergence log, dev journal, backlog |

The same engine runs everywhere; each shell is a thin platform
adapter. The one architectural asymmetry: on desktop the worker
applies wallpapers itself, while on Android the RN side drives the
native setter and acks over the bridge (the "apply inversion" —
see the Android README).

## Status

Working today (emulator + Mac verified): pairing in both directions,
desktop ↔ Android sends with visible wallpaper changes, lock-screen
targeting, share-sheet entry, opportunistic background sync,
revocation. A physical-device QA pass is still pending — see the
checklist at the end of `docs/notes/qa-android.md`. Known gaps and
ideas live in `docs/notes/backlog.md`. iOS: not yet (and Apple
provides no wallpaper API, so it'll be a different shape).

## Running it

Prereqs: Node 22+, and for Android an SDK + emulator or device.

```bash
# Desktop (macOS)
cd desktop && npm install && npm run dev

# Android (no Expo Go — native modules require a real build)
cd android && npm install && npm run android
```

Each shell's README has the full dev loop — including `android/`'s
most important rule: the worklet bundle is ahead-of-time packed, so
changes under `core/`, `bridge/`, or `android/worklet/` need
`npm run bundle:worklet` (Metro only hot-reloads the RN side).

Tests (brittle where Bare/Node is the runtime, jest where RN is):

```bash
(cd core && npm test)
(cd bridge && npm test)
(cd desktop && npm test)
(cd android && npm run test:worklet && npm run test:ui)
```

Manual QA scripts: `docs/notes/qa-desktop.md`, `docs/notes/qa-android.md`.
