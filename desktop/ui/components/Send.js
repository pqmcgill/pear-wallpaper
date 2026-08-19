import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

// CONFLICT-3 ruling (progress.md): no `pickImage` bridge command exists.
// Browse uses a hidden <input type="file">, reading the chosen File's
// `.path` (Electron File objects expose this). Drag-drop reads
// `e.dataTransfer.files[0].path`. Both converge on setFilePath.
export function Send ({ bridge, snapshot }) {
  const [filePath, setFilePath] = useState(null)
  const [targets, setTargets] = useState({})
  const [sendError, setSendError] = useState(null)
  const targetable = snapshot.roster.filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])

  const onDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) setFilePath(f.path)
  }
  const onFileInput = (e) => {
    const f = e.target.files && e.target.files[0]
    if (f) setFilePath(f.path)
  }
  const send = async () => {
    try {
      setSendError(null)
      await bridge.call('sendWallpaper', { filePath, targets: chosen })
      setFilePath(null)
      setTargets({})
    } catch (err) {
      setSendError(err.message)
    }
  }
  const statusFor = (key) => {
    for (const s of snapshot.sends || []) {
      const tr = s.targets.find((tt) => tt.key === key)
      if (tr) return tr.status
    }
    return null
  }

  return html`
    <section class="send" onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
      <label class="dropzone">
        ${filePath || 'Drop an image here, or click to browse'}
        <input type="file" accept="image/*" onChange=${onFileInput} style="display:none" />
      </label>
      <ul>
        ${targetable.map((d) => html`
          <li key=${d.key}>
            <label><input type="checkbox" checked=${!!targets[d.key]}
              onChange=${(e) => setTargets({ ...targets, [d.key]: e.target.checked })} /> ${d.name}</label>
            <span class="status">${statusFor(d.key) || ''}</span>
          </li>`)}
      </ul>
      <button disabled=${!filePath || chosen.length === 0} onClick=${send}>Send</button>
      ${sendError && html`<p class="error">${sendError}</p>`}
    </section>`
}
