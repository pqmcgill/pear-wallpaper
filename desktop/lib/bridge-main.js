/* global Pear */
function createBridgeMain ({ core, platform, loginItem, engine, transport }) {
  async function snapshot () {
    const inGroup = core.groupStatus === 'member'
    return {
      deviceKey: core.deviceKey,
      deviceName: core.deviceName,
      groupStatus: core.groupStatus,
      roster: inGroup ? await core.listDevices() : [],
      sends: inGroup ? await core.listSends() : [],
      received: inGroup ? await core.listReceived() : [],
      loginAtLogin: await loginItem.isEnabled(),
      lastSync: engine.lastSync
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
    sendWallpaper: ({ filePath, targets }) => core.sendWallpaper(filePath, targets),
    reapply: async (wallpaperId) => {
      const list = await core.listReceived({ limit: 50 })
      const item = list.find((r) => r.id === wallpaperId)
      if (!item) throw new Error('unknown received wallpaper')
      await platform.setWallpaper(item.filePath)
    },
    syncNow: () => engine.syncNow(),
    setLoginAtLogin: (on) => (on ? loginItem.enable() : loginItem.disable()),
    // Tray "Quit" (ui/tray.js) has no direct access to core/engine, so it
    // calls back through here. Pear.exit runs Pear.teardown() first, which
    // is where engine.stop()/lock.release()/core.close() happen (index.js).
    quit: () => Pear.exit(0)
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
      engine.on && engine.on('error', (err) => pushEvent('error', { message: err.message }))
      if (engine.on) engine.on('applied', safePushState)
    }
  }
}

module.exports = { createBridgeMain }
