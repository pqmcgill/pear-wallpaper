# pear-wallpaper-desktop

The macOS Pear desktop shell for pear-wallpaper. Boots
`pear-wallpaper-core` (the P2P engine, in `../core`) in the Bare-hosted
app process, and renders a `pear-electron` window/tray on top of it.

## Layout

- `index.js` — main entry (runs under Bare). Acquires the single-instance
  lock, boots `WallpaperCore` and the sync engine, starts a `pear-bridge` +
  `pear-electron` window pair, and wires `bridge-main` to the renderer over
  the `runtime.start()` duplex (see `lib/pear-transport.js`).
- `lib/` — Bare-side (CommonJS) logic: platform (wallpaper-setting),
  login-item, single-instance lock, sync-engine, device-name, bridge-main,
  and the main-side transport adapter.
- `ui/` — the renderer (ESM, ordinary web APIs plus `pear-electron`'s
  `ui` object and `pear-pipe`). `ui/index.html` loads `ui/app.js`, which
  renders the Preact UI, builds its end of the transport
  (`ui/pear-transport.js`), and creates the tray (`ui/tray.js` — tray setup
  has to happen here, not in `index.js`; see that file's comment for why).

## Dev / run / test / stage

```bash
cd desktop
npm install          # sync package-lock.json against package.json
npm test             # brittle test/*.test.js — the automated suite
npm run dev          # == pear run --dev . — local dev, one instance
```

Two instances (for pairing/send QA) each need their own app storage —
`pear run` takes a `--store|-s <path>` flag for this:

```bash
pear run --dev . --store /tmp/pw-a   # "device A"
pear run --dev . --store /tmp/pw-b   # "device B", separate terminal
```

To validate anything that depends on the app's real `pear://<key>` (the
launch-at-login LaunchAgent's `ProgramArguments` invoke `pear run
pear://<key>`, which doesn't resolve from a `--dev` session), stage or
release the app first:

```bash
pear stage <channel> .      # e.g. pear stage desktop-shell .
pear release <channel>      # promote a staged version
```

## Testing split

- **Automated (`npm test`)** — every module under `lib/` and `ui/` has
  brittle unit/component tests with injectable dependencies (fake `fs`,
  fake `exec`, fake `bridge`/`core`): single-instance locking, the
  wallpaper setter's argv-safety, the LaunchAgent plist writer, the
  device-name resolver, the sync engine's apply/coalesce/error-surfacing
  logic, the bridge's command/event wire protocol on both ends, and every
  Preact component's rendering + bridge-call wiring. Current: **37/37
  tests, 73/73 asserts, pristine** — no stray warnings, no skips.
- **Manual (GUI/OS effects `npm test` cannot reach)** — real window
  rendering, the `pear-pipe` IPC transport actually round-tripping across
  the spawned Electron process, macOS's one-time Automation permission
  prompt for the `osascript`/System Events wallpaper setter, tray
  behavior, sleep/wake, and the LaunchAgent's real `launchctl`
  activation against a staged build. Full checklist:
  **[`docs/notes/qa-desktop.md`](../docs/notes/qa-desktop.md)**.
