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

## Scripts

- `npm test` — runs `brittle test/*.test.js`.
- `npm run dev` / `pear run --dev .` — boots the app for local
  development.

## Manual smoke (OS effects — not automated; see task-9-report.md for the
full deferred checklist)

```
cd desktop
pear run --dev .
```

Expected: a window opens to Onboarding (`groupStatus: 'none'`), a tray
icon appears with Open/Sync now/Quit, closing the window hides it instead
of quitting (`pear.gui.closeHides`), and a second `pear run` while one is
up refuses via the single-instance lock.
