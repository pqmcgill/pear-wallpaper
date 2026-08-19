import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

// CONFLICT-3 ruling (progress.md): no `pickImage` bridge command exists.
// Browse uses a hidden <input type="file">, reading the chosen File's
// `.path` (Electron File objects used to expose this). Drag-drop reads
// `e.dataTransfer.files[0].path`. Both converge on setFilePath.
//
// Electron v32 removed the synchronous `File#path` (replaced by
// `webUtils.getPathForFile(file)`), so `.path` may now be undefined. This
// module can't statically `import { webUtils } from 'electron'` or
// `import ui from 'pear-electron'`, because pear-electron's entrypoint
// (node_modules/pear-electron/index.js) reads the global `Pear`, which
// only exists inside the real Pear runtime — a static import would throw
// at module-load time under plain Node (i.e. in this project's brittle
// tests). Instead resolveFilePath dynamically imports 'pear-electron' and
// falls back to null if that fails (not running under Pear) or if the
// host doesn't expose the call, so callers can show the Send error state
// instead of sending a null filePath. pear-electron re-exposes Electron's
// webUtils.getPathForFile as `ui.media.getPathForFile` — see
// node_modules/pear-electron/api.js's `media.getPathForFile`, which wraps
// `ipc.getPathForFile(file)`. This has not been smoke-tested against a
// real Electron v32+ File object end-to-end; it is the mechanism the
// pear-electron API surface provides for this exact purpose, matched by
// name to Electron's own `webUtils.getPathForFile`, but flag it for a
// manual smoke pass (drag-drop and browse, on a build where `.path` is
// actually undefined) before relying on it in the field.
export async function resolveFilePath (file) {
  if (!file) return null
  if (file.path) return file.path
  try {
    const { default: ui } = await import('pear-electron')
    if (ui && ui.media && typeof ui.media.getPathForFile === 'function') {
      const resolved = await ui.media.getPathForFile(file)
      if (resolved) return resolved
    }
  } catch (_err) {
    // Not running under the Pear runtime, or getPathForFile unavailable.
  }
  return null
}

export function Send ({ bridge, snapshot }) {
  const [filePath, setFilePath] = useState(null)
  const [targets, setTargets] = useState({})
  const [sendError, setSendError] = useState(null)
  const targetable = snapshot.roster.filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])

  const pickFile = async (f) => {
    const p = await resolveFilePath(f)
    if (p) {
      setSendError(null)
      setFilePath(p)
    } else {
      setSendError('Could not read a path for that file. Try a different file, or drag it in instead of browsing (or vice versa).')
    }
  }
  const onDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }
  const onFileInput = (e) => {
    const f = e.target.files && e.target.files[0]
    if (f) pickFile(f)
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
