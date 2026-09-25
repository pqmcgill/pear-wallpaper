import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

// Shown until the worker has answered with real state, so a member device
// never flashes Onboarding while it boots or restarts.
export function Starting () {
  return html`<section class="starting"><h1>Pear Wallpaper</h1><p>Starting…</p></section>`
}

// Shown once main.js has given up restarting a crashing worker.
export function WorkerStopped ({ onRetry }) {
  return html`
    <section class="worker-stopped" role="alert">
      <h1>Pear Wallpaper</h1>
      <p>Pear Wallpaper stopped working.</p>
      <button type="button" onClick=${onRetry}>Try again</button>
      <p>If this keeps happening, quit and reopen the app.</p>
    </section>`
}
