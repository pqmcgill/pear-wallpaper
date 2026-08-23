import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { qrSvg } from '../qr.js'
const html = htm.bind(h)

// Maps a joinGroup() rejection's Error#message to user-facing copy. joinGroup
// rejects (it never resolves the "denied" case as a success) with one of the
// blind-pairing coded errors, a supersede message, or 'closed'.
const JOIN_ERROR_MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.',
  'superseded by a newer invite': 'That join attempt was replaced by a newer one.',
  closed: 'The connection closed before joining finished.'
}

// blind-pairing-core's coded errors format Error#message as `${code}:
// ${msg}` (e.g. 'PAIRING_REJECTED: Pairing was rejected'), not the bare
// code, and bridge-main/bridge-ui only relay `.message` across the wire,
// dropping `.code` — so an exact-match lookup on `message` never hit
// PAIRING_REJECTED/INVITE_USED/INVITE_EXPIRED; every rejection silently fell
// through to the generic fallback. Matching by prefix fixes it for the coded
// cases while still exact-matching the plain 'superseded by a newer
// invite'/'closed' messages (a full-string match is also a valid prefix
// match). Mirrors android/components/Onboarding.js's friendlyJoinError.
export function friendlyJoinError (message) {
  const code = message && Object.keys(JOIN_ERROR_MESSAGES).find((c) => message.startsWith(c))
  return (code && JOIN_ERROR_MESSAGES[code]) || 'Could not join. Ask for a fresh invite.'
}

export function Onboarding ({ bridge }) {
  const [invite, setInvite] = useState(null)
  const [createError, setCreateError] = useState(null)
  const [joinValue, setJoinValue] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const create = async () => {
    setCreateError(null)
    try {
      setInvite(await bridge.call('createGroup').then(() => bridge.call('createInvite')))
    } catch (err) {
      setCreateError(err.message)
    }
  }

  const join = async () => {
    setJoinError(null)
    setJoining(true)
    try {
      await bridge.call('joinGroup', joinValue.trim())
    } catch (err) {
      setJoinError(friendlyJoinError(err.message))
    } finally {
      setJoining(false)
    }
  }

  return html`
    <section class="onboarding">
      <h1>Pear Wallpaper</h1>
      <div class="create">
        <button onClick=${create}>Create a group</button>
        ${invite && html`
          <div class="invite">
            <code>${invite}</code>
            <div class="qr" dangerouslySetInnerHTML=${{ __html: qrSvg(invite) }}></div>
          </div>`}
        ${createError && html`<p class="create-error">${createError}</p>`}
      </div>
      <div class="join">
        <input placeholder="Paste invite" value=${joinValue} onInput=${(e) => setJoinValue(e.target.value)} disabled=${joining} />
        <button onClick=${join} disabled=${joining}>${joining ? 'Joining…' : 'Join a group'}</button>
        ${joinError && html`<p class="join-error">${joinError}</p>`}
      </div>
    </section>`
}
