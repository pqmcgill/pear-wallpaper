const PUSH_COALESCE_MS = 50

function createBridgeMain ({ core, transport, engine = null, platform = null, loginItem = null }) {
  // The probe spawns a subprocess (`launchctl print` on macOS), and the
  // answer only changes through setLoginAtLogin, so one probe serves every
  // push until the next toggle.
  let loginProbe = null

  async function snapshot () {
    const inGroup = core.groupStatus === 'member'
    const snap = {
      deviceKey: core.deviceKey,
      deviceName: core.deviceName,
      groupStatus: core.groupStatus,
      roster: inGroup ? await core.listDevices() : [],
      sends: inGroup ? await core.listSends() : [],
      received: inGroup ? await core.listReceived() : [],
      lastSync: engine ? engine.lastSync : null
    }
    // Key omitted (not null) when the shell has no login-item concept
    // (Android): the UI treats "absent" as "don't render the toggle".
    if (loginItem) {
      if (!loginProbe) loginProbe = loginItem.isEnabled()
      snap.loginAtLogin = await loginProbe
    }
    return snap
  }

  async function reapply (wallpaperId) {
    const list = await core.listReceived({ limit: 50 })
    const item = list.find((r) => r.id === wallpaperId)
    if (!item) throw new Error('unknown received wallpaper')
    await platform.setWallpaper(item.filePath)
  }

  async function setLoginAtLogin (on) {
    try {
      await (on ? loginItem.enable() : loginItem.disable())
    } finally {
      loginProbe = null
      pushState()
    }
  }

  const commands = {
    getState: () => snapshot(),
    createGroup: () => core.createGroup(),
    createInvite: () => core.createInvite(),
    joinGroup: (invite) => core.joinGroup(invite),
    approve: (key) => core.approve(key),
    deny: (key) => core.deny(key),
    removeDevice: (key) => core.removeDevice(key),
    sendWallpaper: ({ filePath, targets, filename }) => core.sendWallpaper(filePath, targets, { filename }),
    // Shared across every shell: Android's RN apply path polls
    // pendingWallpaper and acks with markApplied directly over the bridge
    // (spec §3.2 — there is no sync-engine on that side of the wire).
    pendingWallpaper: () => core.pendingWallpaper(),
    markApplied: (wallpaperId) => core.markApplied(wallpaperId),
    ...(engine ? { syncNow: () => engine.syncNow() } : {}),
    ...(platform ? { reapply } : {}),
    ...(loginItem ? { setLoginAtLogin } : {})
    // NOTE (final-review fix wave): a `quit` command used to live here
    // (`() => Pear.exit(0)`), left over from the pre-Electron-conversion
    // pear-runtime UI process shape. `Pear` is not a global in this Bare
    // worker topology, it had no caller, and quit is handled entirely in
    // Electron main (main.js's tray "Quit" -> app.isQuitting = true;
    // app.quit() -> before-quit sends `{ t: 'shutdown' }` to this worker).
    // Removed as dead code.
  }

  function pushEvent (event, payload) { transport.send({ t: 'evt', event, payload }) }

  // One core change arrives as several events spread over a few ms (update,
  // send-updated, wallpaper, applied). Wait out a short window so they share
  // one snapshot, and keep one snapshot in flight at a time so pushes can't
  // resolve out of order: the last push always starts after the last event.
  let pushing = false
  let pushAgain = false
  async function pushState () {
    if (pushing) { pushAgain = true; return }
    pushing = true
    try {
      do {
        await new Promise((resolve) => setTimeout(resolve, PUSH_COALESCE_MS))
        pushAgain = false
        try {
          pushEvent('state', await snapshot())
        } catch (err) {
          pushEvent('error', { message: err.message })
        }
      } while (pushAgain)
    } finally {
      pushing = false
    }
  }

  return {
    start () {
      transport.onMessage(async (msg) => {
        if (!msg || msg.t !== 'req') return
        const fn = commands[msg.cmd]
        if (!fn) return transport.send({ t: 'res', id: msg.id, ok: false, error: `unknown command: ${msg.cmd}` })
        try {
          const value = await fn(...(msg.args || []))
          transport.send({ t: 'res', id: msg.id, ok: true, value })
        } catch (err) {
          transport.send({ t: 'res', id: msg.id, ok: false, error: err.message })
        }
      })
      // Forward core signals as state refreshes + scoped events.
      core.on('update', pushState)
      core.on('roster-changed', pushState)
      core.on('send-updated', pushState)
      core.on('wallpaper', pushState)
      core.on('pairing-request', (p) => pushEvent('candidate', p))
      core.on('error-joining', () => pushEvent('error', { message: 'auto-resume join failed; ask the creator for a fresh invite' }))
      if (engine && engine.on) {
        engine.on('error', (err) => pushEvent('error', { message: err.message }))
        engine.on('applied', pushState)
        engine.on('synced', pushState)
      }
    }
  }
}

module.exports = { createBridgeMain }
