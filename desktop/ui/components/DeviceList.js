import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { qrSvg } from '../qr.js'
const html = htm.bind(h)

export function DeviceList ({ bridge, snapshot, candidates }) {
  const [invite, setInvite] = useState(null)
  const [actionError, setActionError] = useState(null)
  const self = snapshot.roster.find((d) => d.isSelf)
  const amCreator = !!(self && self.isCreator)

  const onCreateInvite = async () => {
    try {
      setActionError(null)
      setInvite(await bridge.call('createInvite'))
    } catch (err) {
      setActionError(err.message)
    }
  }
  const onRemove = async (key) => {
    try {
      setActionError(null)
      await bridge.call('removeDevice', key)
    } catch (err) {
      setActionError(err.message)
    }
  }
  const onApprove = async (candidateKey) => {
    try {
      setActionError(null)
      await bridge.call('approve', candidateKey)
    } catch (err) {
      setActionError(err.message)
    }
  }
  const onDeny = async (candidateKey) => {
    try {
      setActionError(null)
      await bridge.call('deny', candidateKey)
    } catch (err) {
      setActionError(err.message)
    }
  }

  return html`
    <section class="devices">
      <ul>
        ${snapshot.roster.map((d) => html`
          <li key=${d.key}>
            <span class="dot ${d.online ? 'on' : 'off'}"></span>
            ${d.name} ${d.isSelf ? '(this device)' : ''} ${d.isCreator ? '· creator' : ''}
            ${amCreator && !d.isSelf && html`<button onClick=${() => onRemove(d.key)}>Remove</button>`}
          </li>`)}
      </ul>
      ${amCreator && candidates.map((c) => html`
        <div class="candidate" key=${c.candidateKey}>
          <span>${c.name} wants to join</span>
          <button onClick=${() => onApprove(c.candidateKey)}>Approve</button>
          <button onClick=${() => onDeny(c.candidateKey)}>Deny</button>
        </div>`)}
      ${amCreator && html`
        <div class="invite-block">
          <button onClick=${onCreateInvite}>Create invite</button>
          ${invite && html`<code>${invite}</code><div dangerouslySetInnerHTML=${{ __html: qrSvg(invite) }}></div>`}
        </div>`}
      ${actionError && html`<p class="error">${actionError}</p>`}
    </section>`
}
