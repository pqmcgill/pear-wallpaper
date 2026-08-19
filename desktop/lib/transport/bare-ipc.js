'use strict'
// Worker-side transport over a Bare IPC endpoint. `endpoint` must expose
// `.on('data', cb)` and `.write(buf)` (a duplex stream / Bare pipe). Framing:
// newline-delimited JSON so concurrent sends never concatenate into one parse.
function createBareTransport (endpoint) {
  const handlers = []
  let buf = ''
  endpoint.on('data', (chunk) => {
    buf += chunk.toString('utf8')
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
    send (m) { endpoint.write(Buffer.from(JSON.stringify(m) + '\n')) },
    onMessage (cb) { handlers.push(cb) }
  }
}
module.exports = { createBareTransport }
