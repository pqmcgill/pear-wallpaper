import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
const html = htm.bind(h)

export function Settings ({ bridge, snapshot }) {
  const [toggleError, setToggleError] = useState(null)

  const setLoginAtLogin = async (checked) => {
    try {
      setToggleError(null)
      await bridge.call('setLoginAtLogin', checked)
    } catch (err) {
      setToggleError(err.message)
    }
  }

  // Minor fix (final-review): on the error path main replies `ok:false`
  // (see main.js's restartToUpdate catch block), which makes bridge-ui's
  // call() promise reject. With no .catch here that was an unhandled
  // rejection. Surface it the same way the other toggle on this screen
  // does, via the existing error banner state.
  const restartToUpdate = () => {
    bridge.call('restartToUpdate').catch((err) => {
      console.error('[pear-wallpaper] restartToUpdate failed', err)
      setToggleError(err.message)
    })
  }

  const lastSync = snapshot.lastSync ? new Date(snapshot.lastSync).toLocaleString() : 'never'

  return html`
    <section class="settings">
      <p>Device name: <strong>${snapshot.deviceName}</strong> <small>(edit device-name.txt before joining to change)</small></p>
      <p>Device key: <code>${snapshot.deviceKey}</code></p>
      <label><input type="checkbox" checked=${!!snapshot.loginAtLogin}
        onChange=${(e) => setLoginAtLogin(e.target.checked)} /> Launch at login</label>
      <p>Last synced: <span class="last-sync">${lastSync}</span></p>
      ${toggleError && html`<p class="error">${toggleError}</p>`}
      ${snapshot.updateReady && html`
        <p class="update-ready">
          Update available — restart to apply
          <button onClick=${restartToUpdate}>Restart</button>
        </p>`}
    </section>`
}
