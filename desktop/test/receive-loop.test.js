const test = require('brittle')
const path = require('path')
const { createSyncEngine } = require('pear-wallpaper-bridge/engine')
const { pairedDuo, until } = require('pear-wallpaper-core/test/helpers')

function fakePng (size) {
  const buf = Buffer.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// #1 regression, desktop side. The real receive loop (sync-engine's
// applyPending) against a real core that missed three sends while the
// desktop was asleep: the newest is applied exactly once, the older two
// are never applied, and the sender sees them as superseded.
test('receive loop: a desktop that missed three sends applies only the newest', async (t) => {
  const { creator, joiner } = await pairedDuo(t)
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await creator.sendWallpaper(fakePng(4096 * (i + 1)), [joiner.deviceKey])).id)
  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === ids[2]
  })

  const calls = []
  const platform = { async setWallpaper (p) { calls.push(path.basename(p)) } }
  const engine = createSyncEngine({ core: joiner, platform, intervalMs: 1e9 })
  engine.on('error', (e) => t.fail('engine error: ' + e.message))
  await engine.syncNow()

  t.alike(calls, [ids[2] + '.png'], 'the newest send is applied once and the older ones are skipped')
  await until(creator, 'update', async () => (await creator.listSends()).every((s) => s.targets[0].status !== 'pending'))
  const status = Object.fromEntries((await creator.listSends()).map((s) => [s.id, s.targets[0].status]))
  t.alike(ids.map((id) => status[id]), ['superseded', 'superseded', 'delivered'], 'sender sees the skipped sends as superseded')
})
