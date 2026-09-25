const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('../../helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('after acking the newest send, the older unacked one resurfaces (pull path)', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === second.id
  })
  await joiner.markApplied(second.id)

  const next = await joiner.pendingWallpaper()
  t.comment('pendingWallpaper after acking second: ' + (next && (next.id === first.id ? 'FIRST (older)' : next.id)))
  t.is(next, null, 'nothing pending: the older send was superseded')
})

test('after acking the newest send, the older unacked one is emitted as a wallpaper event (push path)', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const seen = []
  joiner.on('wallpaper', ({ id }) => seen.push(id))
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', () => seen.length > 0)
  await new Promise((r) => setTimeout(r, 3000))
  t.comment('wallpaper events seen 3s after both sends landed: ' + seen.map((id) => id === first.id ? 'FIRST' : id === second.id ? 'SECOND' : id).join(','))
  t.ok(seen.includes(second.id), 'the newest send is announced (desktop is event-driven)')
  if (seen.includes(second.id)) {
    await joiner.markApplied(second.id)
    await new Promise((r) => setTimeout(r, 1500))
    t.comment('wallpaper events after acking SECOND: ' + seen.map((id) => id === first.id ? 'FIRST' : id === second.id ? 'SECOND' : id).join(','))
    t.absent(seen.includes(first.id), 'older send must not be emitted after the newer one was applied')
  }

  const sends = await creator.listSends()
  const f = sends.find((s) => s.id === first.id)
  t.comment('creator sees first as: ' + f.targets[0].status)
})
