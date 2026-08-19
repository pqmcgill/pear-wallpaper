import { h, render } from 'preact'
import htm from 'htm'
const html = htm.bind(h)
render(html`<main><h1>Pear Wallpaper</h1><p>booting…</p></main>`, document.getElementById('app'))
