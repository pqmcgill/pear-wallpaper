import { h, render } from 'preact'
import htm from 'htm'
import { createBridgeUi } from './bridge-ui.js'
import { createElectronTransport } from './electron-ipc.js'
import { ErrorBanner } from './components/ErrorBanner.js'
import { Onboarding } from './components/Onboarding.js'
import { Waiting } from './components/Waiting.js'
// Main window (Task 9-11 components) imported here as they land:
import { MainView } from './components/MainView.js'
const html = htm.bind(h)

// Electron conversion (Task 1): the renderer transport is now
// `window.bridgeTransport`, exposed by ../preload.js via contextBridge
// over ipcRenderer. Task 4 adds `createElectronTransport` as the
// renderer-side adapter that bridge-ui consumes (a testable seam over the
// raw preload API). It lives in ui/ as ESM — this file:// page has no
// bundler, so browser ESM cannot import a CJS module from lib/ (there is
// no named-import interop without a bundler) — see ./electron-ipc.js.
const bridge = createBridgeUi(createElectronTransport(window.bridgeTransport))
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
// OTA (Task 6): main.js forwards pear-runtime-updater's 'updated' event as
// this bridge evt once a downloaded update is staged and ready to apply.
// Threaded into the snapshot so Settings can show the restart affordance;
// actually applying/relaunching is a main-process-only action (see
// Settings.js's restartToUpdate call and main.js's ipcMain interception —
// it never reaches the worker).
bridge.on('update-ready', () => { snapshot = { ...snapshot, updateReady: true }; draw() })

bridge.call('getState').then((s) => { snapshot = { ...snapshot, ...s }; draw() })
  .catch((err) => { snapshot = { ...snapshot, lastError: err.message }; draw() })
draw()

// Tray moved to main.js (main-process concern under Electron) — Task 4.
