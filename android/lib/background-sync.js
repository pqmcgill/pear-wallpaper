// Bounded background round = core/README.md's Android recipe, driven from
// the RN side over the bridge: init -> ready -> syncNow -> drain pending
// via the native setter -> shutdown -> terminate. Never runs concurrently
// with the resident worklet (single-writer corestore): if the app is alive
// with an active worklet, we nudge that one instead of opening a second
// (single-writer rule, enforcement point 2 — point 1 is worklet-client.js's
// module-level singleton).
import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import { createApplyController } from './apply-controller'
import { setWallpaper } from '../modules/wallpaper-setter'
import { getTarget } from './settings'
import { isActive, getBridge } from './worklet-client'
import { getStorageDir, getDeviceName } from './worklet-identity'
// Same bundle import as worklet-client.js — the fresh-worklet path below
// must start the exact same core-host bundle the resident worklet runs.
import bundle from '../app/gen/worklet.bundle.mjs'

// Matches core/README.md's Android recipe's own `core.sync({ timeoutMs:
// 30000 })` budget — if the worklet hasn't reached 'ready' by then
// (hung swarm bootstrap, wedged process), give up rather than hold the
// background execution window (and the corestore lock) open forever.
const READY_TIMEOUT_MS = 30000

// No UI to show it on in a headless round; the item stays unacked and the
// foreground app surfaces the same failure on its next pass.
function logApplyError (err) {
  console.log('[background-sync] apply failed:', err && err.message)
}

export async function runBoundedSyncRound () {
  // Single-writer rule, enforcement point 2: existence, not readiness, is
  // the guard condition. isActive() (worklet-client.js) is true as soon as
  // getBridge() has constructed the resident Worklet, before its 'ready'
  // evt — the wrapped bridge already queues bridge.call()s until 'ready'
  // fires (Task 6's readiness-gate fix), so nudging a not-yet-ready
  // resident is safe. Gating on readiness here instead would leave a
  // window — a resident worklet mid-bootstrap (slow swarm resume) — where
  // this round would see "not active" and construct a SECOND Worklet on
  // the same storageDir: exactly the single-writer violation this task
  // exists to prevent.
  if (isActive()) {
    const bridge = getBridge()
    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget, onError: logApplyError }).applyPending()
    return 'nudged-resident'
  }

  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)
  const transport = createDuplexJsonTransport(worklet.IPC)
  const bridge = createBridgeUi(transport)

  // Outer try/finally guarantees the bounded shutdown sequence (shutdown
  // frame -> linger -> terminate) runs on EVERY exit path — success, a
  // pre-ready 'error' evt, or a ready-timeout — not just the happy path.
  // A shutdown frame sent to a worklet that never reached (or will never
  // reach) 'ready' is harmless: the host either hasn't wired anything to
  // ignore it, or has already exited on its own terminal-error path
  // (worklet/host.js) — either way, terminate() still must run so the
  // native Worklet resource is always released.
  try {
    const ready = new Promise((resolve, reject) => {
      bridge.on('ready', resolve)
      bridge.on('error', (e) => reject(new Error((e && e.message) || 'worklet failed to start')))
    })
    // Same storageDir/deviceName construction as worklet-client.js (shared
    // via worklet-identity.js) — a mismatch here would silently fork this
    // device's identity into two independent corestores.
    transport.send({ t: 'init', storageDir: getStorageDir(), deviceName: getDeviceName() })

    let timeoutId
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('worklet ready timed out')), READY_TIMEOUT_MS)
    })
    try {
      await Promise.race([ready, timeout])
    } finally {
      clearTimeout(timeoutId)
    }

    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget, onError: logApplyError }).applyPending()
    return 'synced'
  } finally {
    transport.send({ t: 'shutdown' })                  // graceful corestore close...
    await new Promise((r) => setTimeout(r, 2000))      // ...bounded, like desktop's quit
    worklet.terminate()
  }
}
