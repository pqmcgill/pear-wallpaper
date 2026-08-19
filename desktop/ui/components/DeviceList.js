import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { qrSvg } from '../qr.js'
const html = htm.bind(h)

export function DeviceList ({ bridge, snapshot, candidates }) {
  const [invite, setInvite] = useState(null)
  const self = snapshot.roster.find((d) => d.isSelf)
  const amCreator = !!(self && self.isCreator)
  const invfrom = async () => setInvite(await bridge.call('createInvite'))
  return html`
    <section class="devices">
      <ul>
        ${snapshot.roster.map((d) => html`
          <li key=${d.key}>
            <span class="dot ${d.online ? 'on' : 'off'}"></span>
            ${d.name} ${d.isSelf ? '(this device)' : ''} ${d.isCreator ? '· creator' : ''}
            ${amCreator && !d.isSelf && html`<button onClick=${() => bridge.call('removeDevice', d.key)}>Remove</button>`}
          </li>`)}
      </ul>
      ${amCreator && candidates.map((c) => html`
        <div class="candidate" key=${c.candidateKey}>
          <span>${c.name} wants to join</span>
          <button onClick=${() => bridge.call('approve', c.candidateKey)}>Approve</button>
          <button onClick=${() => bridge.call('deny', c.candidateKey)}>Deny</button>
        </div>`)}
      ${amCreator && html`
        <div class="invite-block">
          <button onClick=${invfrom}>Create invite</button>
          ${invite && html`<code>${invite}</code><div dangerouslySetInnerHTML=${{ __html: qrSvg(invite) }}></div>`}
        </div>`}
    </section>`
}
