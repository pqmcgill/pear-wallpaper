import { h } from 'preact'
import htm from 'htm'
import { ErrorBanner } from './ErrorBanner.js'
import { Onboarding } from './Onboarding.js'
import { Waiting } from './Waiting.js'
import { MainView } from './MainView.js'
import { Starting, WorkerStopped } from './WorkerStatus.js'
const html = htm.bind(h)

// worker is main.js's supervisor status: 'running' | 'restarting' | 'failed'.
// snapshot.groupStatus stays null until the worker has answered once.
function routedView ({ bridge, snapshot, worker, onRetry }) {
  if (worker === 'failed') return html`<${WorkerStopped} onRetry=${onRetry} />`
  if (worker === 'restarting' || snapshot.groupStatus == null) return html`<${Starting} />`
  if (snapshot.groupStatus === 'joining') return html`<${Waiting} snapshot=${snapshot} />`
  if (snapshot.groupStatus === 'member') return html`<${MainView} bridge=${bridge} snapshot=${snapshot} />`
  return html`<${Onboarding} bridge=${bridge} />`
}

export function AppView (props) {
  const { snapshot, worker, onDismissError } = props
  // While the worker is down the status screen is the message; errors from
  // the outage itself would only repeat it.
  return html`
    <div class="app-root">
      ${worker === 'running' && snapshot.lastError && html`<${ErrorBanner} message=${snapshot.lastError} onDismiss=${onDismissError} />`}
      ${routedView(props)}
    </div>`
}
