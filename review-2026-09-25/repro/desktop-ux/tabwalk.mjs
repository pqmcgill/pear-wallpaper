const [,, port, n = '8'] = process.argv
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.blur(); window.focus()' })
for (let i = 0; i < Number(n); i++) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  const r = await send('Runtime.evaluate', { expression: `(() => { const e = document.activeElement; const o = getComputedStyle(e); return e.tagName + ' ' + (e.type||'') + ' "' + (e.innerText || e.parentElement.innerText || '').trim().slice(0,40) + '" visible=' + (e.offsetParent !== null) + ' outline=' + o.outlineStyle })()`, returnByValue: true })
  console.log(i + 1, r.result.result.value)
}
process.exit(0)
