const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('acks: markApplied flips sender status to delivered and fires send-updated', async function (t) {
  t.plan(3)
  const { creator, joiner } = await pairedDuo(t)

  creator.on('send-updated', ({ id }) => t.is(typeof id, 'string'))

  joiner.on('wallpaper', async ({ id }) => {
    await joiner.markApplied(id)
  })

  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(creator, 'update', async () => {
    const [send] = await creator.listSends()
    return send.targets[0].status === 'delivered'
  })
  const [send] = await creator.listSends()
  t.is(send.id, id)
  t.is(send.targets[0].status, 'delivered')
})

test('acks: older send becomes superseded once a newer one is applied', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === second.id
  })
  await joiner.markApplied(second.id)

  await until(creator, 'update', async () => {
    const sends = await creator.listSends()
    const f = sends.find((s) => s.id === first.id)
    return f.targets[0].status === 'superseded'
  })
  t.pass('old send reported superseded, not stuck pending')
})

test('acks: listReceived returns applied history newest-first', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const a = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])

  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)
  await joiner.markApplied((await joiner.pendingWallpaper()).id)

  const received = await joiner.listReceived()
  t.is(received.length, 1)
  t.is(received[0].id, a.id)
  t.is(typeof received[0].appliedAt, 'number')
  t.ok(received[0].filePath.endsWith('.png'))
})
