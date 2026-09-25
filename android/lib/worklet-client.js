import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import { createApplyController } from './apply-controller'
import { setWallpaper } from '../modules/wallpaper-setter'
import { getTarget } from './settings'
import { getStorageDir, getDeviceName } from './worklet-identity'
// bare-pack's --out .../worklet.bundle.mjs (bundle:worklet script) is an ES
// module wrapper whose default export is the raw bundle source string
// (bare-pack README's "bundle format" table: `bundle.mjs` -> ".bundle.mjs"
// -> "ES module wrapper for a .bundle") — the same string shape Worklet#start
// accepts as `source`. This mirrors the template echo screen's inline
// `worklet.start(path, source)` call, just with a generated bundle instead
// of a literal string.
import bundle from '../app/gen/worklet.bundle.mjs'

// Single-writer rule. The corestore under storageDir takes a file lock, so
// this process may have at most one Worklet open on it, and this module is
// the only place that constructs one. Two callers share it:
//   - the resident UI (_layout.js) claims it through getBridge() for the
//     life of the process;
//   - a bounded background round (background-sync.js) leases it through
//     leaseWorklet() and shuts it down on release() — unless the UI claimed
//     it in the meantime, in which case the round hands it over.
// `instance` is the live worklet, or null. While a release is shutting it
// down (`closing` set) it stays here so a new start can wait for the lock.
let instance = null

// Bounded shutdown, like desktop's quit: ask the host to close the corestore,
// give it a moment, then terminate regardless.
const SHUTDOWN_LINGER_MS = 2000

function start () {
  const previous = instance && instance.closing
  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)

  const transport = createDuplexJsonTransport(worklet.IPC)
  const realBridge = createBridgeUi(transport)

  // Readiness gate. worklet/host.js only wires bridge-main's 'req' handler
  // AFTER core.ready() resolves, and the newline-JSON transport does no
  // queueing of its own — a bridge.call() sent before the host's 'ready'
  // evt is silently dropped on the wire, and its promise never settles. So
  // 'starting' queues calls and replays them on 'ready'; 'ready' passes
  // them straight through; 'dead' (the worklet failed to start, or was shut
  // down) rejects them, so no caller ever hangs on a worklet that is gone.
  let state = 'starting'
  let deadError = null
  const pending = []
  const errorListeners = new Set()
  const bridge = {
    call (cmd, ...args) {
      if (state === 'ready') return realBridge.call(cmd, ...args)
      if (state === 'dead') return Promise.reject(deadError)
      return new Promise((resolve, reject) => { pending.push({ cmd, args, resolve, reject }) })
    },
    on (event, cb) {
      if (event === 'error') errorListeners.add(cb)
      return realBridge.on(event, cb)
    },
    applyPending: () => controller.applyPending()
  }

  // One apply pass at a time per worklet: every trigger (the UI's state
  // pushes, its mount-time getState, a background nudge) goes through this
  // controller so overlapping triggers coalesce instead of each setting and
  // acking the same wallpaper. Apply failures reach the UI the way engine
  // errors do, as a bridge 'error' event; the log line is for headless
  // rounds, which have no UI to show it on.
  const controller = createApplyController({
    bridge,
    setter: setWallpaper,
    getTarget,
    onError: (err) => {
      console.log('[worklet-client] apply failed:', err && err.message)
      const payload = { message: `Couldn't set the new wallpaper: ${err.message}` }
      for (const cb of errorListeners) cb(payload)
    }
  })

  let resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  ready.catch(() => {})

  const inst = {
    worklet,
    transport,
    bridge,
    ready,
    resident: false,
    closing: null,
    die (err) {
      if (state === 'dead') return
      state = 'dead'
      deadError = err
      for (const { reject } of pending.splice(0)) reject(err)
      rejectReady(err)
      if (instance === inst) instance = null
    }
  }

  realBridge.on('ready', () => {
    if (state !== 'starting') return
    state = 'ready'
    for (const { cmd, args, resolve, reject } of pending.splice(0)) {
      realBridge.call(cmd, ...args).then(resolve, reject)
    }
    resolveReady()
  })

  // Terminal-error contract (worklet/host.js): a failed init frame makes the
  // Bare process exit(1) — 'ready' never fires for that instance. Once
  // 'ready' has fired, later 'error' evts are ordinary operational errors
  // forwarded by bridge-main (engine failures, auto-resume-join failures)
  // and do NOT mean the process died. No in-app retry is wired to this:
  // storageDir/deviceName are static for the process lifetime, so a fresh
  // Worklet would fail identically; the recovery is fixing whatever made
  // storage unwritable, or restarting the app.
  realBridge.on('error', (payload) => {
    if (state !== 'starting') return
    inst.die(new Error((payload && payload.message) || 'worklet failed to start'))
  })

  // init MUST precede any bridge.call (host ignores bridge frames pre-init).
  // The corestore lock is taken while the host handles init, so when the
  // previous worklet is still shutting down, hold the frame until it has
  // been terminated; calls made meanwhile just wait in the readiness queue.
  const init = { t: 'init', storageDir: getStorageDir(), deviceName: getDeviceName() }
  if (previous) previous.then(() => transport.send(init))
  else transport.send(init)

  instance = inst
  return inst
}

function live () {
  return instance && !instance.closing ? instance : start()
}

async function close (inst) {
  inst.transport.send({ t: 'shutdown' })
  await new Promise((r) => setTimeout(r, SHUTDOWN_LINGER_MS))
  inst.worklet.terminate()
  inst.die(new Error('worklet shut down'))
}

// The resident UI's handle. Starts the worklet if none is live, and marks it
// resident so no background round shuts it down from under the app.
export function getBridge () {
  const inst = live()
  inst.resident = true
  return inst.bridge
}

export function getWorklet () {
  return instance ? instance.worklet : null
}

// A bounded round's handle. `reused` says whether a worklet was already live
// (the round should just nudge it). `ready` settles when the worklet can
// take calls, or rejects if it failed to start. `release()` shuts the
// worklet down unless the UI claimed it through getBridge() in the meantime.
export function leaseWorklet () {
  const reused = instance !== null && !instance.closing
  const inst = live()
  return {
    bridge: inst.bridge,
    ready: inst.ready,
    reused,
    async release () {
      if (inst.resident) return
      if (!inst.closing) inst.closing = close(inst)
      await inst.closing
    }
  }
}
