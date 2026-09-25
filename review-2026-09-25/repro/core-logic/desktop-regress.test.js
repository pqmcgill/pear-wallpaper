const test = require('brittle')
const b4a = require('b4a')
const { createSyncEngine } = require('../../../../bridge/sync-engine.js')
const { pairedDuo, until } = require('../../helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// The desktop shell's real receive loop (bridge/sync-engine.js) against a
// phone that queued two sends while the desktop was offline.
test('desktop receive loop: two queued sends end with the OLDER one on the desktop', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const applied = []
  const engine = createSyncEngine({ core: joiner, platform: { setWallpaper: async (p) => { applied.push(p) } } })
  engine.on('error', (e) => t.comment('engine error: ' + e.message))
  engine.start()
  t.teardown(() => engine.stop())

  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(creator, 'update', async () => {
    const sends = await creator.listSends()
    return sends.every((s) => s.targets[0].status !== 'pending')
  }, 15000)
  await new Promise((r) => setTimeout(r, 1000))
  const label = (p) => p.includes(first.id) ? 'FIRST' : p.includes(second.id) ? 'SECOND' : p
  t.comment('setWallpaper calls in order: ' + applied.map(label).join(' -> '))
  t.is(label(applied[applied.length - 1]), 'SECOND', 'the newest send is what ends up on the desktop')
  const sends = await creator.listSends()
  t.comment('creator sees: ' + sends.map((s) => (s.id === first.id ? 'first=' : 'second=') + s.targets[0].status).join(', '))
  t.is(sends.find((s) => s.id === first.id).targets[0].status, 'superseded')
})
