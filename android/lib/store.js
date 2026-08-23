export const initialSnapshot = {
  groupStatus: 'none', roster: [], sends: [], received: [],
  lastError: null, joinError: null
}

export function reduce (snap, action) {
  switch (action.type) {
    case 'state': return { ...snap, ...action.payload }
    case 'error': {
      // Interactive join rejections come back through joinGroup's own
      // promise; the one join-shaped failure arriving here is a resumed
      // pending join failing on startup — groupStatus is still 'joining'
      // with no state push to clear it, so route it into joinError too
      // (same reasoning as desktop ui/app.js).
      const next = { ...snap, lastError: action.payload.message }
      return next.groupStatus === 'joining' ? { ...next, joinError: action.payload.message } : next
    }
    case 'dismiss-error': return { ...snap, lastError: null }
    default: return snap
  }
}
