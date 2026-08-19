// Build the system tray via pear-electron's `ui.app.tray`.
//
// This lives in ui/ (the renderer), not lib/, deliberately: `ui.app` only
// exists where `Pear.constructor.UI` is set, which is only true inside the
// spawned Electron UI process (see lib/pear-transport.js for the full
// citation trail). The Bare-hosted app process (desktop/index.js) has no
// `ui.app` to call `.tray()` on, so the task-9 brief's
// `createTray({ui, ...})` called from index.js can't work against the real
// API — this module is the corrected placement, called from ui/app.js
// where `ui.app.tray` is real.
//
// `onOpen` is handled purely locally (`ui.app.show()`/`focus()` on this
// same window). `onSyncNow` / `onQuit` need the Bare process's core/engine,
// so they go back over the bridge transport (bridge-main already exposes a
// `syncNow` command; a `quit` command was added alongside it).
export async function createTray ({ ui, iconPath, onOpen, onSyncNow, onQuit }) {
  const untray = await ui.app.tray(
    {
      icon: iconPath,
      menu: { open: 'Open Pear Wallpaper', sync: 'Sync now', quit: 'Quit' }
    },
    (key) => {
      if (key === 'open' || key === 'click' || key === 'show') return onOpen()
      if (key === 'sync') return onSyncNow()
      if (key === 'quit') return onQuit()
    }
  )
  return untray
}
