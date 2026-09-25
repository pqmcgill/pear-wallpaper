const test = require('brittle')
const b4a = require('b4a')
const WallpaperCore = require('../../../index.js')
const { pairedDuo, until } = require('../../helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

test('first ack after the sender restarts: send-updated fires', async function (t) {
  const { creator, joiner, tn } = await pairedDuo(t)
  const dir = creator.storageDir
  const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)
  await creator.close()

  const creator2 = new WallpaperCore({ storageDir: dir, deviceName: 'creator', bootstrap: tn.bootstrap })
  await creator2.ready()
  t.teardown(() => creator2.close())
  let updates = 0
  creator2.on('update', () => updates++)
  const got = []
  creator2.on('send-updated', (e) => got.push(e.id))
  await until(creator2, 'roster-changed', async () => (await creator2.listDevices()).some((d) => !d.isSelf && d.online))
  t.comment('updates seen since reopen before the ack: ' + updates)

  await joiner.markApplied(id)
  await until(creator2, 'update', async () => {
    const [s] = await creator2.listSends()
    return s.targets[0].status === 'delivered'
  })
  await new Promise((r) => setTimeout(r, 300))
  t.comment('send-updated ids after the ack: ' + JSON.stringify(got) + ' (update events total: ' + updates + ')')
  t.ok(got.includes(id), 'send-updated fired for the first ack after restart')
})
