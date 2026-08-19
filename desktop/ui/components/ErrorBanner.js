import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

// Renders snapshot.lastError (set by ui/app.js's bridge 'error' listener)
// as a dismissible banner. Before this component existed, lastError was
// stored but never rendered anywhere, so engine/apply/auto-resume-join
// failures (e.g. a denied macOS Automation prompt) were silently invisible
// to the user (final-review item 1).
export function ErrorBanner ({ message, onDismiss }) {
  if (!message) return null
  return html`
    <div class="error-banner" role="alert">
      <span class="error-banner-message">${message}</span>
      <button type="button" class="error-banner-dismiss" onClick=${onDismiss} aria-label="Dismiss">×</button>
    </div>`
}
