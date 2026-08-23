'use strict'
// Newline-JSON framing over any duplex endpoint exposing .on('data') and
// .write(). Uses b4a (not Buffer) so the identical module runs under Bare
// (desktop worker, Android worklet) and RN's JS runtime (worklet.IPC on the
// UI side) — Buffer is not a global in RN.
const b4a = require('b4a')
function createDuplexJsonTransport (endpoint) {
  const handlers = []
  let buf = ''
  endpoint.on('data', (chunk) => {
    buf += b4a.toString(chunk, 'utf8')
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      for (const h of handlers) h(msg)
    }
  })
  return {
    send (m) { endpoint.write(b4a.from(JSON.stringify(m) + '\n')) },
    onMessage (cb) { handlers.push(cb) }
  }
}
module.exports = { createDuplexJsonTransport }
