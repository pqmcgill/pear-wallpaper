import { h } from 'preact'
import { useState, useRef } from 'preact/hooks'
import htm from 'htm'
import { Presence } from './Presence.js'
import { Sent, fileName } from './Sent.js'
const html = htm.bind(h)

// CONFLICT-3 ruling (progress.md): no `pickImage` bridge command exists.
// Browse uses a hidden <input type="file">, reading the chosen File's
// `.path` (Electron File objects used to expose this). Drag-drop reads
// `e.dataTransfer.files[0].path`. Both converge on setFilePath.
//
// Electron v32 removed the synchronous `File#path` (replaced by
// `webUtils.getPathForFile(file)`), so `.path` may now be undefined.
// `webUtils` itself is only reachable via `require('electron')`, which
// this renderer can't do directly (contextIsolation: true, nodeIntegration:
// false) — and the previous fix-attempt here (`await import('pear-electron')`)
// always failed once Task 1 dropped that dependency, silently degrading
// browse/drag-drop to the error banner on any Electron >=32 build (this
// repo pins electron@^33). Fixed properly: preload.js requires 'electron'
// (preload runs with that privilege) and exposes
// `window.pathForFile = (file) => webUtils.getPathForFile(file)` via
// contextBridge. The renderer's File object (from the <input> change event
// or the drop event) is passed straight through that bridge call — File/
// Blob objects are one of the value types contextBridge passes by
// reference rather than structured-cloning, which is what makes this work
// despite contextIsolation. `getPathForFile` is synchronous, so no promise
// round-trip is needed. Not smoke-tested against a real Electron File
// object end-to-end in this pass (headless test env has no such object);
// flagged as a manual smoke item (drag-drop and browse) before relying on
// it in the field — see docs/notes/qa-desktop.md Act 3.
export function resolveFilePath (file) {
  if (!file) return null
  if (file.path) return file.path
  try {
    if (typeof window !== 'undefined' && typeof window.pathForFile === 'function') {
      const resolved = window.pathForFile(file)
      if (resolved) return resolved
    }
  } catch (_err) {
    // Not running under Electron's preload bridge, or getPathForFile
    // rejected the value (e.g. not a real File object).
  }
  return null
}

// Core's own check runs on the pick, so a file it can't send (an iPhone
// HEIC, a renamed file, one over the size cap) is refused now, not after
// the user has chosen devices and pressed Send.
export async function checkPick (bridge, file) {
  const filePath = resolveFilePath(file)
  if (!filePath) throw new Error('Could not read a path for that file. Try a different file, or drag it in instead of browsing (or vice versa).')
  await bridge.call('checkImage', { filePath })
  return filePath
}

export function Send ({ bridge, snapshot }) {
  const [filePath, setFilePath] = useState(null)
  const [targets, setTargets] = useState({})
  const [sendError, setSendError] = useState(null)
  const fileInput = useRef(null)
  const targetable = snapshot.roster.filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])

  const pickFile = async (f) => {
    try {
      const p = await checkPick(bridge, f)
      setSendError(null)
      setFilePath(p)
    } catch (err) {
      setFilePath(null)
      setSendError(err.message)
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
  return html`
    <section class="send" onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
      <button type="button" class="dropzone" onClick=${() => fileInput.current.click()}
        aria-label=${filePath ? `Picture to send: ${fileName(filePath)}. Choose a different picture` : undefined}>
        ${filePath ? fileName(filePath) : 'Drop a JPEG, PNG or WebP picture here, or click to browse'}
      </button>
      <input type="file" ref=${fileInput} aria-label="Picture to send" accept="image/jpeg,image/png,image/webp" onChange=${onFileInput} style="display:none" />
      <ul>
        ${targetable.map((d) => html`
          <li key=${d.key}>
            <label><input type="checkbox" checked=${!!targets[d.key]}
              onChange=${(e) => setTargets({ ...targets, [d.key]: e.target.checked })} /> ${d.name}</label>
            <${Presence} online=${d.online} />
          </li>`)}
      </ul>
      <button disabled=${!filePath || chosen.length === 0} onClick=${send}>Send</button>
      ${sendError && html`<p class="error">${sendError}</p>`}
      <${Sent} snapshot=${snapshot} />
    </section>`
}
