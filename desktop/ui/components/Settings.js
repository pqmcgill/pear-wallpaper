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

  return html`
    <section class="settings">
      <p>Device name: <strong>${snapshot.deviceName}</strong> <small>(edit device-name.txt before joining to change)</small></p>
      <p>Device key: <code>${snapshot.deviceKey}</code></p>
      <label><input type="checkbox" checked=${!!snapshot.loginAtLogin}
        onChange=${(e) => setLoginAtLogin(e.target.checked)} /> Launch at login</label>
      ${toggleError && html`<p class="error">${toggleError}</p>`}
    </section>`
}
