const test = require('brittle')

test('Settings shows "never" for lastSync when null', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Settings } = await import('../ui/components/Settings.js')
  const snapshot = { deviceName: 'Mac', deviceKey: 'aa', loginAtLogin: false, lastSync: null }
  const html = render(h(Settings, { bridge: {}, snapshot }))
  t.ok(/never/i.test(html))
})

test('Settings shows a rendered timestamp for lastSync when set', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Settings } = await import('../ui/components/Settings.js')
  const ts = Date.UTC(2026, 0, 1, 12, 0, 0)
  const snapshot = { deviceName: 'Mac', deviceKey: 'aa', loginAtLogin: false, lastSync: ts }
  const html = render(h(Settings, { bridge: {}, snapshot }))
  t.ok(/last-sync/.test(html))
  t.absent(/never/i.test(html))
})
