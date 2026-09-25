const test = require('brittle')

test('resolveFilePath returns file.path directly when present', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath({ path: '/tmp/pic.jpg' }), '/tmp/pic.jpg')
})

test('resolveFilePath falls back to null when file.path is absent and pear-electron is unreachable (e.g. under test/plain Node)', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath({ name: 'pic.jpg' }), null)
})

test('resolveFilePath returns null for a falsy file', async (t) => {
  const { resolveFilePath } = await import('../ui/components/Send.js')
  t.is(await resolveFilePath(null), null)
})

test('Send lists targetable devices (excludes self) and disables send with none chosen', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'aa', name: 'Mac', isSelf: true }, { key: 'bb', name: 'Tablet', isSelf: false }], sends: [] }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Tablet/.test(html), 'lists a target')
  t.absent(/>Mac</.test(html.replace(/this device/g, '')), 'self not a target row')
})

test('Send disables the button until a file and at least one target are chosen', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'bb', name: 'Tablet', isSelf: false }], sends: [] }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/<button[^>]*disabled/.test(html), 'send button starts disabled')
})

test('Send target rows show whether each device is online', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }, { key: 'cc', name: 'Laptop', isSelf: false, online: false }],
    sends: []
  }
  const html = render(h(Send, { bridge: {}, snapshot }))
  t.ok(/Tablet.*?online.*?Laptop/s.test(html), 'Tablet reads online')
  t.ok(/Laptop.*?offline/s.test(html), 'Laptop reads offline')
})

test('a device row shows no status from a previous send', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }],
    sends: [{ id: 's1', meta: { filename: 'beach.png' }, sentAt: 1, targets: [{ key: 'bb', status: 'delivered' }] }]
  }
  const html = render(h(Send, { bridge: {}, snapshot }))
  const picker = html.split('class="sent"')[0]
  t.ok(/Tablet/.test(picker), 'Tablet is still a target')
  t.absent(/delivered/i.test(picker), 'the target row does not claim the next picture was delivered')
})

test('recently sent lists each send with its picture and a friendly status per device', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }, { key: 'cc', name: 'Laptop', isSelf: false, online: false }],
    sends: [
      { id: 's2', meta: { filename: '/Users/me/Pictures/beach.png' }, sentAt: 2, targets: [{ key: 'bb', status: 'pending' }, { key: 'cc', status: 'pending' }] },
      { id: 's1', meta: { filename: 'C:\\pics\\dog.jpg' }, sentAt: 1, targets: [{ key: 'bb', status: 'superseded' }, { key: 'dd', status: 'delivered' }] }
    ]
  }
  const sent = render(h(Send, { bridge: {}, snapshot })).split('class="sent"')[1]
  t.ok(/Recently sent/.test(sent), 'has a heading')
  t.ok(/beach\.png[\s\S]*dog\.jpg/.test(sent), 'newest first, by picture name')
  t.absent(/Users|pics/.test(sent), 'shows the file name, not the folder')
  t.ok(/Tablet[\s\S]*Not delivered yet[\s\S]*Laptop[\s\S]*Waiting for Laptop to come online/.test(sent), 'pending reads not delivered yet, or waiting when offline')
  t.ok(/Tablet[\s\S]*Replaced by a newer picture/.test(sent), 'superseded reads replaced by a newer picture')
  t.ok(/A removed device[\s\S]*Delivered/.test(sent), 'delivered, to a device no longer in the group')
  t.absent(/pending|superseded/.test(sent.replace(/<[^>]*>/g, '')), 'no raw core states')
})

test('recently sent copes with a send that has no file name', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = {
    roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }],
    sends: [{ id: 's1', meta: { filename: null }, sentAt: 1, targets: [{ key: 'bb', status: 'delivered' }] }]
  }
  const sent = render(h(Send, { bridge: {}, snapshot })).split('class="sent"')[1]
  t.ok(/A picture/.test(sent), 'falls back to a generic label')
})

test('no recently sent section before anything is sent', async (t) => {
  const { render } = await import('preact-render-to-string')
  const { h } = await import('preact')
  const { Send } = await import('../ui/components/Send.js')
  const snapshot = { roster: [{ key: 'bb', name: 'Tablet', isSelf: false, online: true }], sends: [] }
  t.absent(/Recently sent/.test(render(h(Send, { bridge: {}, snapshot }))))
})
