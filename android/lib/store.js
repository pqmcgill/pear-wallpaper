export const initialSnapshot = {
  groupStatus: 'none', roster: [], sends: [], received: [],
  lastError: null, joinError: null
}

export function reduce (snap, action) {
  switch (action.type) {
    case 'state': return { ...snap, ...action.payload }
    case 'error': {
      // The one join-shaped failure arriving here (as opposed to via
      // 'join-error', below) is a resumed pending join failing on
      // startup — groupStatus is still 'joining' with no state push to
      // clear it, so route it into joinError too (same reasoning as
      // desktop ui/app.js).
      const next = { ...snap, lastError: action.payload.message }
      return next.groupStatus === 'joining' ? { ...next, joinError: action.payload.message } : next
    }
    // A LIVE interactive joinGroup() rejection, dispatched by Onboarding's
    // attemptJoin catch. Sets joinError ONLY — never lastError/ErrorBanner
    // — because Onboarding already renders its own friendly inline copy
    // whenever it's still mounted to receive the rejection (e.g. a
    // garbage invite that never opens a connection). This action exists
    // for the other case: a live candidate connection's 'roster-changed'
    // has already routed the UI to Waiting before the rejection lands,
    // and joinError is the only state Waiting can see. Dispatching
    // 'error' instead (as an earlier version of this fix did) would pop a
    // redundant, unfriendly ErrorBanner over Onboarding's own already-
    // friendly copy in the garbage-invite case — a real regression,
    // caught in review.
    case 'join-error': return { ...snap, joinError: action.payload.message }
    case 'dismiss-error': return { ...snap, lastError: null }
    default: return snap
  }
}
