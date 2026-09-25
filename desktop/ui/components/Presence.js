import { h } from 'preact'
import htm from 'htm'
const html = htm.bind(h)

export function Presence ({ online }) {
  return html`<span class="presence ${online ? 'on' : 'off'}"><span class="dot" aria-hidden="true"></span>${online ? 'online' : 'offline'}</span>`
}
