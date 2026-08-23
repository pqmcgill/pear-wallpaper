import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import { getStorageDir, getDeviceName } from './worklet-identity'
// bare-pack's --out .../worklet.bundle.mjs (bundle:worklet script) is an ES
// module wrapper whose default export is the raw bundle source string
// (bare-pack README's "bundle format" table: `bundle.mjs` -> ".bundle.mjs"
// -> "ES module wrapper for a .bundle") — the same string shape Worklet#start
// accepts as `source`. This mirrors the template echo screen's inline
// `worklet.start(path, source)` call, just with a generated bundle instead
// of a literal string.
import bundle from '../app/gen/worklet.bundle.mjs'

let instance = null

export function getBridge () {
  if (instance) return instance.bridge

  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)

  const transport = createDuplexJsonTransport(worklet.IPC)
  const realBridge = createBridgeUi(transport)

  // Readiness gate (post-Task-6 fix — diagnosed while building Task 6,
  // applies here since worklet-client.js is where init/readiness ordering
  // is owned). worklet/host.js only wires bridge-main's 'req' handler
  // AFTER core.ready() resolves, and the newline-JSON transport does no
  // queueing of its own — a bridge.call() sent before the host's 'ready'
  // evt is silently dropped on the wire (nothing on the other end is
  // listening for 'req' frames yet), and its promise never settles.
  // _layout.js's mount-time `bridge.call('getState')` can race exactly
  // this on a resumed member device with a slow swarm bootstrap, stranding
  // the UI on Onboarding despite real membership. Below, `bridge.call()`
  // queues while `!ready` and replays every queued call once 'ready'
  // fires — the Task 3 host contract guarantees 'ready' is emitted only
  // once bridge-main is wired, so replaying then is always safe. Calls
  // made after 'ready' pass straight through with no added latency.
  // `on()` is an untouched passthrough — events still come straight off
  // the real bridge, only `call()` is gated.
  let ready = false
  const pending = []
  const bridge = {
    call (cmd, ...args) {
      if (ready) return realBridge.call(cmd, ...args)
      return new Promise((resolve, reject) => { pending.push({ cmd, args, resolve, reject }) })
    },
    on (event, cb) { return realBridge.on(event, cb) }
  }

  realBridge.on('ready', () => {
    ready = true
    // Replay in arrival order; each call's own request/response id
    // round-trip through the real bridge from here, same as any call made
    // after ready.
    for (const { cmd, args, resolve, reject } of pending.splice(0)) {
      realBridge.call(cmd, ...args).then(resolve, reject)
    }
  })

  // Terminal-error contract (worklet/host.js): a failed init frame makes the
  // Bare process exit(1) — 'ready' never fires for that instance and a
  // second init frame on it would be ignored forever. Once 'ready' has
  // fired, later 'error' evts are ordinary operational errors forwarded by
  // bridge-main (engine failures, auto-resume-join failures, etc.) and do
  // NOT mean the process died, so the singleton must survive those — only
  // clear it for an error that arrives before 'ready' ever did.
  // No in-app retry is wired to this — deliberately. storageDir/deviceName
  // are static for the process lifetime, so a fresh Worklet started with
  // the same inputs would fail identically; the only real recovery is
  // fixing whatever made storage unwritable (or restarting the app) after
  // the terminal error surfaces via lastError. Clearing the singleton here
  // just means the NEXT cold getBridge() call — a later screen mounting,
  // Task 9's background path, or a restarted app — starts clean instead of
  // handing back a bridge wired to a dead Worklet. Any call still queued
  // at this point never had a live 'req' handler to answer it, so it's
  // rejected here rather than left to hang forever.
  realBridge.on('error', (payload) => {
    if (ready) return
    instance = null
    const err = new Error((payload && payload.message) || 'worklet failed to start')
    for (const { reject } of pending.splice(0)) reject(err)
  })

  // init MUST precede any bridge.call (host ignores bridge frames
  // pre-init) — and now that bridge.call() itself queues until 'ready',
  // readiness ordering is guaranteed the same way init ordering already
  // was: nothing reaches the wire before the host is listening for it.
  transport.send({
    t: 'init',
    storageDir: getStorageDir(),
    deviceName: getDeviceName()
  })

  instance = { worklet, bridge, transport }
  return bridge
}

export function getWorklet () {
  return instance ? instance.worklet : null
}

// Single-writer guard, consumed by Task 9's background-sync.js: true as
// soon as a resident worklet EXISTS, not only once it has reached 'ready'.
// This is deliberate, not an oversight: getBridge()'s wrapped `bridge`
// (above) already queues bridge.call()s until 'ready' fires, so nudging a
// not-yet-ready resident is safe — the call just waits in that queue like
// any other caller's would. Gating this on readiness instead would open a
// window, during a resident worklet's bootstrap (e.g. a slow swarm
// resume), where isActive() reads false and the background round
// constructs a SECOND Worklet on the same storageDir — exactly the
// single-writer violation this task exists to prevent. A terminal
// pre-ready error still clears `instance` (below), so isActive() correctly
// goes back to false the moment the resident worklet is actually gone.
export function isActive () {
  return instance !== null
}
