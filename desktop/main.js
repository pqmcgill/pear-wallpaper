'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let win = null
function createWindow () {
  win = new BrowserWindow({
    width: 480,
    height: 660,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadFile('ui/index.html')
}

// Minimal echo so Task 1 can prove the preload transport before the worker exists.
ipcMain.on('bridge:to-main', (_evt, msg) => {
  if (win) win.webContents.send('bridge:to-renderer', { t: 'echo', got: msg })
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
