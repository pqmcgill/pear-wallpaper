// The Android half of the apply inversion (spec §3.2): the worklet surfaces
// pending wallpapers over the bridge; this controller runs the native setter
// and acks. Mirrors sync-engine's applyPending semantics exactly — coalesced
// passes, and a setter/ack failure leaves the item unacked so the next
// trigger retries it.
export function createApplyController ({ bridge, setter, getTarget = () => 'home' }) {
  let applying = false
  let queued = false
  async function applyPending () {
    if (applying) { queued = true; return }
    applying = true
    try {
      while (true) {
        const item = await bridge.call('pendingWallpaper')
        if (!item) break
        await setter(item.filePath, getTarget())   // throws -> stays unacked
        await bridge.call('markApplied', item.id)
      }
    } catch {
      // swallowed by design: unacked item retries on the next trigger
    } finally {
      applying = false
      if (queued) { queued = false; applyPending() }
    }
  }
  return { applyPending }
}
