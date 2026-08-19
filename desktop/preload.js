'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeTransport', {
  send: (msg) => ipcRenderer.send('bridge:to-main', msg),
  onMessage: (cb) => ipcRenderer.on('bridge:to-renderer', (_evt, msg) => cb(msg))
})
