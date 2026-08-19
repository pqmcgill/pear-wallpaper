import { h, render } from 'preact'
import htm from 'htm'
import ui from 'pear-electron'
import { createBridgeUi } from './bridge-ui.js'
import { createPearTransportUi } from './pear-transport.js'
import { createTray } from './tray.js'
import { ErrorBanner } from './components/ErrorBanner.js'
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
