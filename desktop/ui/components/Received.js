import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

const CONFIRM_MS = 3000

function senderName (roster, key) {
  const device = (roster || []).find((d) => d.key === key)
  return device ? device.name : 'a removed device'
}

// Groups from before core basenamed meta.filename still replicate the
// sender's full path.
function baseName (filename) {
  return filename ? filename.split(/[\\/]/).pop() : null
}

function when (ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function Received ({ bridge, snapshot }) {
  const [reapplyError, setReapplyError] = useState(null)
  const [reappliedId, setReappliedId] = useState(null)

  useEffect(() => {
    if (!reappliedId) return
    const timer = setTimeout(() => setReappliedId(null), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [reappliedId])

  const reapply = async (id) => {
    try {
      setReapplyError(null)
      setReappliedId(null)
      await bridge.call('reapply', id)
      setReappliedId(id)
    } catch (err) {
      setReapplyError(err.message)
    }
  }

  return html`
    <section class="received">
      <ul>
        ${(snapshot.received || []).map((r) => {
          const name = baseName(r.meta && r.meta.filename)
          return html`
            <li key=${r.id}>
              <img src=${'file://' + encodeURI(r.filePath)} alt="" width="120" />
              <span class="from">
                <strong>From ${senderName(snapshot.roster, r.fromKey)}</strong>
                <small>${when(r.appliedAt)}${name ? ' · ' + name : ''}</small>
              </span>
              <button onClick=${() => reapply(r.id)}>Re-apply</button>
              ${reappliedId === r.id && html`<span class="ok">Wallpaper set</span>`}
            </li>`
        })}
      </ul>
      ${reapplyError && html`<p class="error">${reapplyError}</p>`}
    </section>`
}
