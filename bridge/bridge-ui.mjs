export function createBridgeUi (transport) {
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  transport.onMessage((msg) => {
    if (!msg) return
    if (msg.t === 'res') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error))
    } else if (msg.t === 'evt') {
      const set = listeners.get(msg.event)
      if (set) for (const cb of set) cb(msg.payload)
    }
  })
  return {
    call (cmd, ...args) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        transport.send({ t: 'req', id, cmd, args })
      })
    },
    on (event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(cb)
    }
  }
}
