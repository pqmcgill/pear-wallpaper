import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

// Originally documented as covering only the restart-resumed-join path
// (main resumes a pending join on startup and, if it fails, emits a bare
// 'error-joining' signal via lib/bridge-main.js). That's incomplete: a LIVE
// joinGroup() rejection can also land here — a candidate connection's
// 'roster-changed' routes the UI to Waiting before the joinGroup() promise
// settles, and Onboarding forwards that rejection into snapshot.joinError
// for exactly that reason (see its attemptJoin). So this map needs the full
// joinGroup() rejection taxonomy, kept identical to Onboarding's
// JOIN_ERROR_MESSAGES. Mirrors android/components/Waiting.js.
const MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.',
  'superseded by a newer invite': 'That join attempt was replaced by a newer one.',
  closed: 'The connection closed before joining finished.'
}

// blind-pairing-core's coded errors format Error#message as `${code}:
// ${msg}`, not the bare code, and bridge-main/bridge-ui only relay
// `.message` — an exact-match lookup never hit. Prefix match instead, same
// fix as Onboarding.js's friendlyJoinError.
function friendlyMessage (message) {
  const code = message && Object.keys(MESSAGES).find((c) => message.startsWith(c))
  return (code && MESSAGES[code]) || 'Could not join. Ask for a fresh invite.'
}

export function Waiting ({ snapshot }) {
  const err = snapshot.joinError
  if (err) return html`<section class="waiting error"><p>${friendlyMessage(err)}</p></section>`
  return html`<section class="waiting"><p>Waiting for an existing device to come online and approve this one…</p></section>`
}
