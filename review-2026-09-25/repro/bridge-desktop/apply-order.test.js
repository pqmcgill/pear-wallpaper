const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('../../helpers.js')
const { createSyncEngine } = require('../../../../bridge/sync-engine.js')

function png (n) { const b = b4a.alloc(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); b.writeUInt32BE(n, 16); return b }

test('receiver that missed 3 sends ends on the newest wallpaper', { timeout: 120000 }, async (t) => {
  const { creator, joiner } = await pairedDuo(t)
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await creator.sendWallpaper(png(i), [joiner.deviceKey])).id)
  await until(joiner, 'update', async () => {
    let n = 0
    for await (const node of joiner.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) n++ // eslint-disable-line
    return n === 3
  }, 30000)
  const calls = []
  const platform = { async setWallpaper (p) { calls.push(p.split('/').pop()) } }
  const engine = createSyncEngine({ core: joiner, platform, intervalMs: 1e9 })
  engine.on('error', (e) => t.comment('engine error ' + e.message))
  await engine.syncNow()
  t.comment('sent in order: ' + ids.join(', '))
  t.comment('setWallpaper calls in order: ' + calls.join(', '))
  const creatorView = await creator.listSends()
  t.comment('sender statuses: ' + creatorView.map((s) => s.id + '=' + s.targets[0].status).join(', '))
  t.is(calls[calls.length - 1], ids[2] + '.png', 'final wallpaper is the newest send')
  t.is(calls.length, 1, 'stale queued sends are skipped (spec: targets act only on the latest)')
})
