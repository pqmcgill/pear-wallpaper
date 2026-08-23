import { createContext, useEffect, useReducer, useState } from 'react'
import { AppState } from 'react-native'
import { Slot } from 'expo-router'
import { reduce, initialSnapshot } from '../lib/store'
import { getBridge, getWorklet } from '../lib/worklet-client'
import { createApplyController } from '../lib/apply-controller'
import { setWallpaper } from '../modules/wallpaper-setter'
import { getTarget } from '../lib/settings'

// Default value covers the case where a screen is rendered outside this
// provider (e.g. a unit test that mounts app/index.js directly): bridge is
// null and snapshot is the untouched initialSnapshot, so routing still
// works and no bridge.call() ever fires.
export const SnapshotContext = createContext({ snapshot: initialSnapshot, bridge: null, dispatch: () => {} })

export default function Layout () {
  const [snapshot, dispatch] = useReducer(reduce, initialSnapshot)
  const [bridge, setBridge] = useState(null)

  useEffect(() => {
    // Single-writer rule, enforcement point 1: getBridge() is a module-level
    // singleton (lib/worklet-client.js) — only ever one Worklet/corestore
    // for the life of this provider.
    const bridge = getBridge()
    setBridge(bridge)

    // getTarget (lib/settings.js, Task 7) reads the lock-screen toggle's
    // persisted preference fresh on every apply pass — 'both' when the
    // Settings tab's toggle is on, 'home' otherwise. Was hardcoded to
    // `() => 'home'` before Task 7's settings module existed.
    const controller = createApplyController({ bridge, setter: setWallpaper, getTarget })

    bridge.on('state', (payload) => {
      dispatch({ type: 'state', payload })
      controller.applyPending()
    })
    bridge.on('error', (payload) => dispatch({ type: 'error', payload }))

    bridge.call('getState')
      .then((payload) => {
        dispatch({ type: 'state', payload })
        controller.applyPending()
      })
      .catch((err) => dispatch({ type: 'error', payload: { message: err.message } }))

    // AppState suspend/resume — the RN-side lifecycle duty the desktop
    // renderer never had. 'active' mirrors desktop main.js's
    // powerMonitor 'resume' handler (wake the worklet, then re-sync
    // immediately rather than waiting for the next periodic tick).
    // 'background' suspends the Bare thread with a linger window so a
    // quick foreground/background flip (e.g. switching apps briefly)
    // doesn't tear down and reboot the worklet.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getWorklet()?.resume()
        bridge.call('syncNow').catch((err) => dispatch({ type: 'error', payload: { message: err.message } }))
      } else if (state === 'background') {
        getWorklet()?.suspend(30000)
      }
    })

    return () => sub.remove()
  }, [])

  return (
    <SnapshotContext.Provider value={{ snapshot, dispatch, bridge }}>
      <Slot />
    </SnapshotContext.Provider>
  )
}
