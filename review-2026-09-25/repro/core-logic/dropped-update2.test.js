const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('../../helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// Deterministic form: the receive sweep for FIRST is held inside its blob
// fetch (as a slow link would) while SECOND lands, then released.
test('a send that lands while the receive sweep is fetching is never announced', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const real = joiner._materializeNow.bind(joiner)
  let release
  const gate = new Promise((r) => { release = r })
  let calls = 0
  joiner._materializeNow = async (entry, filePath) => {
    calls++
    if (calls === 1) await gate
    return real(entry, filePath)
  }
  const t0 = Date.now()
  const updates = []
  joiner.on('update', () => updates.push(Date.now() - t0))
  const seen = []
  joiner.on('wallpaper', ({ id }) => seen.push({ id, at: Date.now() - t0 }))
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  await until(joiner, 'update', () => calls >= 1)
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.base.view.get('send/' + second.id)) !== null)
  release()
  await new Promise((r) => setTimeout(r, 15000))
  const label = (id) => id === first.id ? 'FIRST' : id === second.id ? 'SECOND' : id
  t.comment('update events (ms): ' + JSON.stringify(updates))
  t.comment('wallpaper events: ' + seen.map((s) => `${label(s.id)}@${s.at}ms`).join(', '))
  t.comment('pendingWallpaper now: ' + label(((await joiner.pendingWallpaper()) || {}).id))
  t.ok(seen.some((s) => s.id === second.id), 'newest send announced within 15s of landing')
})
