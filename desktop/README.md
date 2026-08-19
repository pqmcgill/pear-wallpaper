# pear-wallpaper-desktop

The macOS Pear desktop shell for pear-wallpaper. Boots
`pear-wallpaper-core` (the P2P engine, in `../core`) and renders a
`pear-electron` window on top of it. This is a scaffold: the UI is a
placeholder, and tray/sync-engine/bridge wiring land in later tasks.

## Layout

- `index.js` — main entry (runs under Bare). Boots `WallpaperCore`
  with `Pear.config.storage` as `storageDir`, then starts a
  `pear-bridge` + `pear-electron` window pair.
- `ui/` — the renderer (ESM, ordinary web APIs). `ui/index.html` loads
  `ui/app.js`, a Preact placeholder.

## Scripts

- `npm test` — runs `brittle test/*.test.js` (no tests yet; this task
  is wiring only).
- `npm run dev` / `pear run --dev .` — boots the app for local
  development.

## Manual smoke (OS effects — not automated)

```
cd desktop
pear run --dev .
```

Expected: a window opens showing "Pear Wallpaper / booting…", and the
terminal logs `[pear-wallpaper] booted; deviceKey=<hex> status=none`.
