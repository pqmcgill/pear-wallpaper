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
    setLoginAtLogin: (on) => (on ? loginItem.enable() : loginItem.disable())
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
      core.on('update', pushState)
      core.on('roster-changed', pushState)
      core.on('send-updated', pushState)
      core.on('wallpaper', pushState)
      core.on('pairing-request', (p) => pushEvent('candidate', p))
      core.on('error-joining', () => pushEvent('error', { message: 'auto-resume join failed; ask the creator for a fresh invite' }))
      engine.on && engine.on('error', (err) => pushEvent('error', { message: err.message }))
      engine.on && engine.on('applied', pushState)
    }
  }
}

module.exports = { createBridgeMain }
