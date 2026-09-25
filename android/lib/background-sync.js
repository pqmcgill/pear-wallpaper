// Bounded background round = core/README.md's Android recipe, driven from
// the RN side over the bridge: ready -> syncNow -> drain pending via the
// native setter -> release. The worklet itself comes from worklet-client.js
// (the single-writer enforcement point): a lease reuses the resident
// worklet when the app is alive and just nudges it, starts one when the
// process was respawned headless, and release() only shuts that one down if
// the app has not claimed it in the meantime.
import { leaseWorklet } from './worklet-client'

// Matches core/README.md's Android recipe's own `core.sync({ timeoutMs:
// 30000 })` budget — if the worklet hasn't reached 'ready' by then
// (hung swarm bootstrap, wedged process), give up rather than hold the
// background execution window (and the corestore lock) open forever.
const READY_TIMEOUT_MS = 30000

export async function runBoundedSyncRound () {
  const lease = leaseWorklet()
  try {
    let timeoutId
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('worklet ready timed out')), READY_TIMEOUT_MS)
    })
    try {
      await Promise.race([lease.ready, timeout])
    } finally {
      clearTimeout(timeoutId)
    }

    await lease.bridge.call('syncNow')
    await lease.bridge.applyPending()
    return lease.reused ? 'nudged-resident' : 'synced'
  } finally {
    await lease.release()
  }
}
