// Renderer-side transport wrapping the preload-exposed endpoint
// (`window.bridgeTransport`). Kept as a module (not inlined) for a testable
// seam and to normalize the {send,onMessage} shape.
//
// Lives in ui/ (not lib/transport/) because the renderer is a plain file://
// page with no bundler: browser ESM cannot consume a CommonJS module, so
// this must be genuine ESM — and ui/package.json's `"type": "module"` is the
// scope that makes .js files here ESM (desktop/package.json is commonjs).
export function createElectronTransport (api) {
  return { send: (m) => api.send(m), onMessage: (cb) => api.onMessage(cb) }
}
