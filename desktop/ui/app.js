import { h, render } from 'preact'
import htm from 'htm'
import { createBridgeUi } from './bridge-ui.js'
import { ErrorBanner } from './components/ErrorBanner.js'
import { Onboarding } from './components/Onboarding.js'
import { Waiting } from './components/Waiting.js'
// Main window (Task 9-11 components) imported here as they land:
import { MainView } from './components/MainView.js'
const html = htm.bind(h)

// Electron conversion (Task 1): the renderer transport is now
// `window.bridgeTransport`, exposed by ../preload.js via contextBridge
// over ipcRenderer. A proper renderer-side adapter (matching whatever
// shape bridge-ui expects) lands in Task 4; for Task 1 this is used
// directly so the app boots and the preload IPC channel can be proven.
const bridge = createBridgeUi(window.bridgeTransport)
let snapshot = { groupStatus: 'none', roster: [], sends: [], received: [] }

function dismissError () { snapshot = { ...snapshot, lastError: null }; draw() }

function routedView () {
  if (snapshot.groupStatus === 'joining') return html`<${Waiting} snapshot=${snapshot} />`
  if (snapshot.groupStatus === 'member') return html`<${MainView} bridge=${bridge} snapshot=${snapshot} />`
  return html`<${Onboarding} bridge=${bridge} />`
}
function App () {
  return html`
    <div class="app-root">
      ${snapshot.lastError && html`<${ErrorBanner} message=${snapshot.lastError} onDismiss=${dismissError} />`}
      ${routedView()}
    </div>`
}
function draw () { render(h(App, {}), document.getElementById('app')) }

bridge.on('state', (s) => { snapshot = { ...snapshot, ...s }; draw() })
// The bridge's 'error' event is {message} only — engine/apply/auto-resume
// failures, not interactive join outcomes. Interactive join rejections come
// back through the joinGroup command's own promise (handled locally in
// Onboarding), so this must never overwrite Onboarding's local join error.
// The one join-shaped case that DOES arrive here is a resumed pending join
// (core's _open() replaying a saved invite on startup) failing: core emits
// a bare 'error-joining' with no code, which bridge-main forwards as this
// same {message} 'error' event. At that point the last-pushed snapshot
// still has groupStatus 'joining' (no accompanying state push clears it),
// so that's the signal used to also route the failure into Waiting via
// joinError — otherwise a resumed join failure was invisible (only
// lastError was set, and nothing rendered it either).
bridge.on('error', (e) => {
  snapshot = { ...snapshot, lastError: e.message }
  if (snapshot.groupStatus === 'joining') snapshot = { ...snapshot, joinError: e.message }
  draw()
})
bridge.call('getState').then((s) => { snapshot = { ...snapshot, ...s }; draw() })
  .catch((err) => { snapshot = { ...snapshot, lastError: err.message }; draw() })
draw()

// Tray moved to main.js (main-process concern under Electron) — Task 4.
