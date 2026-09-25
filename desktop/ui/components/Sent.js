import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

// Same words as Android's Sent tab (android/components/Sent.js).
const STATUS = {
  pending: 'Not delivered yet',
  delivered: 'Delivered',
  superseded: 'Replaced by a newer picture'
}

// meta.filename has held a full path; keep only the last segment either way.
function pictureName (meta) {
  const filename = meta && meta.filename
  return filename ? filename.split(/[\\/]/).pop() : 'A picture'
}

// snapshot.sends is core's listSends: this device's sends, newest first.
export function Sent ({ snapshot }) {
  const sends = snapshot.sends || []
  if (sends.length === 0) return null

  const targetRow = (t) => {
    const device = snapshot.roster.find((d) => d.key === t.key)
    const status = t.status === 'pending' && device && !device.online
      ? `Waiting for ${device.name} to come online`
      : STATUS[t.status]
    return html`<li key=${t.key}>${device ? device.name : 'A removed device'} <span class="status ${t.status}">${status}</span></li>`
  }

  return html`
    <div class="sent">
      <h3>Recently sent</h3>
      <ul>
        ${sends.map((s) => html`
          <li key=${s.id}>
            <div class="sent-head">${pictureName(s.meta)} <span class="when">${new Date(s.sentAt).toLocaleString()}</span></div>
            <ul>
              ${s.targets.map(targetRow)}
            </ul>
          </li>`)}
      </ul>
    </div>`
}
