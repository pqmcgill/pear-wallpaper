import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

// This map covers the restart-resumed-join path only: main resumes a
// pending join on startup and, if it fails, emits a bare 'error-joining'
// signal (no message detail) via lib/bridge-main.js. The interactive
// rejection UX (with the full joinGroup() rejection taxonomy) lives in
// Onboarding, which awaits bridge.call('joinGroup', ...) directly.
const MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.'
}

export function Waiting ({ snapshot }) {
  const err = snapshot.joinError
  if (err) return html`<section class="waiting error"><p>${MESSAGES[err] || 'Could not join. Ask for a fresh invite.'}</p></section>`
  return html`<section class="waiting"><p>Waiting for an existing device to come online and approve this one…</p></section>`
}
