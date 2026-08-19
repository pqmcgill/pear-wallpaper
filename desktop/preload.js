'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('bridgeTransport', {
  send: (msg) => ipcRenderer.send('bridge:to-main', msg),
  onMessage: (cb) => ipcRenderer.on('bridge:to-renderer', (_evt, msg) => cb(msg))
})

// Send.js fix (final-review): `webUtils` is only accessible via `require(
// 'electron')` in a Main or Renderer/preload-privileged context — the
// unprivileged renderer itself (contextIsolation: true, nodeIntegration:
// false in main.js's BrowserWindow) can't `require('electron')` at all.
// But `webUtils.getPathForFile(file)` needs the *actual* File object,
// which only exists in the renderer (e.g. from a <input type="file">
// change event or a drop event). The standard Electron pattern is exactly
// this: expose a thin sync wrapper from the preload (which CAN require
// 'electron' and see webUtils) through contextBridge, then call it from
// the renderer passing the File object straight through — contextBridge
// structured-clones most values, but Blob/File objects are one of the
// documented exceptions it passes through by reference for this reason.
// `getPathForFile` is synchronous (returns a string, not a Promise), so
// this is exposed as a plain function, not wrapped in ipcRenderer.invoke.
contextBridge.exposeInMainWorld('pathForFile', (file) => webUtils.getPathForFile(file))
