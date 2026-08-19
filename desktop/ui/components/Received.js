import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

export function Received ({ bridge, snapshot }) {
  const [reapplyError, setReapplyError] = useState(null)

  const reapply = async (id) => {
    try {
      setReapplyError(null)
      await bridge.call('reapply', id)
    } catch (err) {
      setReapplyError(err.message)
    }
  }

  return html`
    <section class="received">
      <ul>
        ${(snapshot.received || []).map((r) => html`
          <li key=${r.id}>
            <img src=${'file://' + encodeURI(r.filePath)} alt="" width="120" />
            <span>${(r.meta && r.meta.filename) || r.id}</span>
            <button onClick=${() => reapply(r.id)}>Re-apply</button>
          </li>`)}
      </ul>
      ${reapplyError && html`<p class="error">${reapplyError}</p>`}
    </section>`
}
