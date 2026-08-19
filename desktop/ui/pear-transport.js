// Renderer-side counterpart to ../lib/pear-transport.js.
//
// `pear-pipe`, when invoked from inside the pear-electron renderer (its
// factory function checks `which-runtime`'s `isElectronRenderer`), resolves
// to a `PearElectronPipe` that relays through `ui.app`'s ipc `.pipe()`
// method — which, per pear-electron's GitHub source (gui/ipc.js's
// `pipe() { return new Stream('pipe') }`, forwarded by electron-main.js to
// its own inherited fd 3) — is the *same* logical duplex the Bare-hosted
// app process received back from `runtime.start()`. This is why there is
// no separate "preload exposes window.__pearTransport" step to hook into:
// pear-electron doesn't ship one for app-level messages, so this module
// (and its wiring into app.js) *is* that mechanism.
//
// Framing matches lib/pear-transport.js: newline-delimited JSON.
import pipeFactory from 'pear-pipe'

export function createPearTransportUi () {
  const pipe = pipeFactory()
  const handlers = []
  let buf = ''
  pipe.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (err) {
        continue
      }
      for (const h of handlers) h(msg)
    }
  })
  return {
    send (m) { pipe.write(JSON.stringify(m) + '\n') },
    onMessage (cb) { handlers.push(cb) }
  }
}
