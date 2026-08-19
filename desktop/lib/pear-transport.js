'use strict'

// Main-side transport: bridges bridge-main (which owns WallpaperCore/the
// sync engine, and therefore must run in the Bare-hosted app process) to
// the pear-electron UI process.
//
// The task-9 brief sketched this over pear-electron's window IPC
// (`win.send` / `win.on('message')`). That API is real, but per
// node_modules/pear-electron/index.js:
//
//   module.exports = Pear.constructor.UI ? Pear[Pear.constructor.UI] : require('./runtime')
//
// `Pear.constructor.UI` (and the `ui.app` / `ui.Window` / `ui.View` object
// it exposes) is only populated *inside the spawned Electron process*
// (confirmed by cross-referencing pear-electron's GitHub source:
// electron-main.js does `global.Pear = new API(gui.ipc, state)` — that's
// where the UI-mixin API class actually gets constructed; boot.js only
// requires that file when `isElectron && !isElectronRenderer`). In the
// Bare-hosted app process (this file's caller, desktop/index.js),
// `require('pear-electron')` resolves to the plain `Runtime` class — there
// is no `win` handle to reach into from here.
//
// What IS available symmetrically on both sides is the parent<->child
// duplex that `runtime.start()` returns (fd 3, backed by the `pear-pipe`
// package pear-electron itself depends on). The renderer gets the *other
// end* of the same duplex via `pear-pipe` too — see ui/pear-transport.js —
// because `pear-pipe`'s factory function explicitly branches on
// `isElectronRenderer` to relay through `ui.app`'s ipc.pipe() instead of a
// raw fd. See task-9-report.md for the full trail of evidence.
//
// Messages are framed as newline-delimited JSON so that concurrent sends
// can't get concatenated into a single JSON.parse call.
function createPearTransportMain (pipe) {
  const handlers = []
  let buf = ''
  pipe.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (err) {
        continue // malformed frame; drop rather than crash the pipe reader
      }
      for (const h of handlers) h(msg)
    }
  })
  return {
    send (m) { pipe.write(JSON.stringify(m) + '\n') },
    onMessage (cb) { handlers.push(cb) }
  }
}

module.exports = { createPearTransportMain }
