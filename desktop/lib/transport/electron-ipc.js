'use strict'
// Renderer-side transport wrapping the preload-exposed endpoint
// (`window.bridgeTransport`). Kept as a module (not inlined) for a testable
// seam and to normalize the {send,onMessage} shape.
function createElectronTransport (api) {
  return { send: (m) => api.send(m), onMessage: (cb) => api.onMessage(cb) }
}
module.exports = { createElectronTransport }
