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

export async function runBoundedSyncRound () {
  if (isActive()) {
    const bridge = getBridge()
    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget }).applyPending()
    return 'nudged-resident'
  }

  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)
  const transport = createDuplexJsonTransport(worklet.IPC)
  const bridge = createBridgeUi(transport)
  const ready = new Promise((resolve, reject) => {
    bridge.on('ready', resolve)
    bridge.on('error', (e) => reject(new Error((e && e.message) || 'worklet failed to start')))
  })
  // Same storageDir/deviceName construction as worklet-client.js (shared
  // via worklet-identity.js) — a mismatch here would silently fork this
  // device's identity into two independent corestores.
  transport.send({ t: 'init', storageDir: getStorageDir(), deviceName: getDeviceName() })
  await ready
  try {
    await bridge.call('syncNow')
    await createApplyController({ bridge, setter: setWallpaper, getTarget }).applyPending()
  } finally {
    transport.send({ t: 'shutdown' })                  // graceful corestore close...
    await new Promise((r) => setTimeout(r, 2000))      // ...bounded, like desktop's quit
    worklet.terminate()
  }
  return 'synced'
}
