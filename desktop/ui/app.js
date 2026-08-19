import { h, render } from 'preact'
import htm from 'htm'
import { createBridgeUi } from './bridge-ui.js'
import { Onboarding } from './components/Onboarding.js'
import { Waiting } from './components/Waiting.js'
// Main window (Task 9-11 components) imported here as they land:
import { MainView } from './components/MainView.js'
const html = htm.bind(h)

// pearTransport is provided by the preload/runtime; see pear-transport wiring (Task 9).
const bridge = createBridgeUi(window.__pearTransport)
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
