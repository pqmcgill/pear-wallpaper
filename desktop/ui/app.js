import { h, render } from 'preact'
import htm from 'htm'
import ui from 'pear-electron'
import { createBridgeUi } from './bridge-ui.js'
import { createPearTransportUi } from './pear-transport.js'
import { createTray } from './tray.js'
import { Onboarding } from './components/Onboarding.js'
import { Waiting } from './components/Waiting.js'
// Main window (Task 9-11 components) imported here as they land:
import { MainView } from './components/MainView.js'
const html = htm.bind(h)

// Task 9: pear-electron has no preload step that hands the renderer a
// `window.__pearTransport` global for app-level messages — see
// ../lib/pear-transport.js for why, and ./pear-transport.js for the real
// mechanism (the `pear-pipe` duplex shared with the Bare-hosted app
// process). `window.__pearTransport` is kept as an override hook (e.g. for
// tests that stub it) but production wiring builds its own.
const bridge = createBridgeUi(window.__pearTransport || createPearTransportUi())
let snapshot = { groupStatus: 'none', roster: [], sends: [], received: [] }

function App () {
  if (snapshot.groupStatus === 'joining') return html`<${Waiting} snapshot=${snapshot} />`
  if (snapshot.groupStatus === 'member') return html`<${MainView} bridge=${bridge} snapshot=${snapshot} />`
  return html`<${Onboarding} bridge=${bridge} />`
}
function draw () { render(h(App, {}), document.getElementById('app')) }

bridge.on('state', (s) => { snapshot = { ...snapshot, ...s }; draw() })
// The bridge's 'error' event is {message} only — engine/apply/auto-resume
// failures, not join outcomes. Join rejections come back through the
// joinGroup command's own promise (handled locally in Onboarding), so this
// must never set a join-specific field here.
bridge.on('error', (e) => { snapshot = { ...snapshot, lastError: e.message }; draw() })
bridge.call('getState').then((s) => { snapshot = { ...snapshot, ...s }; draw() })
draw()

// Tray: must be created here, not in the Bare-main entrypoint — see
// ./tray.js for why. `onOpen` stays local to this window; `onSyncNow`/
// `onQuit` need core/engine, so they go back over the bridge.
createTray({
  ui,
  iconPath: 'ui/trayTemplate.png',
  onOpen: () => { ui.app.show(); ui.app.focus({ steal: true }) },
  onSyncNow: () => bridge.call('syncNow'),
  onQuit: () => bridge.call('quit')
}).catch((err) => console.error('[pear-wallpaper] tray setup failed', err))
