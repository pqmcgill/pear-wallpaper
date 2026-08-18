const test = require('brittle')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir, until } = require('./helpers')

async function createPair(t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())
  return { creator, joiner, tn }
}

test('approve: joiner becomes a member and both see the full roster', async function (t) {
  const { creator, joiner } = await createPair(t)

  const invite = await creator.createInvite()
  creator.on('pairing-request', ({ candidateKey }) => creator.approve(candidateKey))

  await joiner.joinGroup(invite)
  t.is(joiner.groupStatus, 'member')

  await until(creator, 'update', async () => (await creator.listDevices()).length === 2)
  const creatorSees = await creator.listDevices()
  const joinerSees = await joiner.listDevices()
  t.is(creatorSees.length, 2)
  t.is(joinerSees.length, 2)
  const names = joinerSees.map((d) => d.name).sort()
  t.alike(names, ['creator', 'phone'])
  t.is(joinerSees.find((d) => d.isSelf).name, 'phone')
})

test('deny: candidate is dropped and the invite is dead', async function (t) {
  t.plan(4)
  const { creator, joiner } = await createPair(t)
  const invite = await creator.createInvite()

  creator.on('pairing-request', async ({ candidateKey }) => {
    await creator.deny(candidateKey)
    t.is(creator._pending.size, 0)
    const inv = await creator.base.view.get('invite')
    t.is(inv, null, 'deny burns the invite')
    t.pass('denied without throwing')
  })

  await t.exception(joiner.joinGroup(invite), 'denied join rejects instead of hanging')
})
