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

function friendlyJoinError (message) {
  return JOIN_ERROR_MESSAGES[message] || 'Could not join. Ask for a fresh invite.'
}

export function Onboarding ({ bridge }) {
  const [invite, setInvite] = useState(null)
  const [joinValue, setJoinValue] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const create = async () => { setInvite(await bridge.call('createGroup').then(() => bridge.call('createInvite'))) }

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
      </div>
      <div class="join">
        <input placeholder="Paste invite" value=${joinValue} onInput=${(e) => setJoinValue(e.target.value)} disabled=${joining} />
        <button onClick=${join} disabled=${joining}>${joining ? 'Joining…' : 'Join a group'}</button>
        ${joinError && html`<p class="join-error">${joinError}</p>`}
      </div>
    </section>`
}
