function createBridgeMain ({ core, transport, engine = null, platform = null, loginItem = null }) {
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
    if (loginItem) snap.loginAtLogin = await loginItem.isEnabled()
    return snap
  }

  async function reapply (wallpaperId) {
    const list = await core.listReceived({ limit: 50 })
    const item = list.find((r) => r.id === wallpaperId)
    if (!item) throw new Error('unknown received wallpaper')
    await platform.setWallpaper(item.filePath)
  }

  const commands = {
    getState: () => snapshot(),
    createGroup: () => core.createGroup(),
    createInvite: () => core.createInvite(),
    joinGroup: (invite) => core.joinGroup(invite),
    approve: (key) => core.approve(key),
    deny: (key) => core.deny(key),
    removeDevice: (key) => core.removeDevice(key),
    sendWallpaper: ({ filePath, targets }) => core.sendWallpaper(filePath, targets),
    // Shared across every shell: Android's RN apply path polls
    // pendingWallpaper and acks with markApplied directly over the bridge
    // (spec §3.2 — there is no sync-engine on that side of the wire).
    pendingWallpaper: () => core.pendingWallpaper(),
    markApplied: (wallpaperId) => core.markApplied(wallpaperId),
    ...(engine ? { syncNow: () => engine.syncNow() } : {}),
    ...(platform ? { reapply } : {}),
    ...(loginItem ? { setLoginAtLogin: (on) => (on ? loginItem.enable() : loginItem.disable()) } : {})
    // NOTE (final-review fix wave): a `quit` command used to live here
    // (`() => Pear.exit(0)`), left over from the pre-Electron-conversion
    // pear-runtime UI process shape. `Pear` is not a global in this Bare
    // worker topology, it had no caller, and quit is handled entirely in
    // Electron main (main.js's tray "Quit" -> app.isQuitting = true;
    // app.quit() -> before-quit sends `{ t: 'shutdown' }` to this worker).
    // Removed as dead code.
  }

  function pushEvent (event, payload) { transport.send({ t: 'evt', event, payload }) }
  async function pushState () { pushEvent('state', await snapshot()) }

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
      const safePushState = () => pushState().catch((err) => pushEvent('error', { message: err.message }))
      core.on('update', safePushState)
      core.on('roster-changed', safePushState)
      core.on('send-updated', safePushState)
      core.on('wallpaper', safePushState)
      core.on('pairing-request', (p) => pushEvent('candidate', p))
      core.on('error-joining', () => pushEvent('error', { message: 'auto-resume join failed; ask the creator for a fresh invite' }))
      if (engine && engine.on) {
        engine.on('error', (err) => pushEvent('error', { message: err.message }))
        engine.on('applied', safePushState)
      }
    }
  }
}

module.exports = { createBridgeMain }
