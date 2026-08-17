const test = require('brittle')
const WallpaperCore = require('../index.js')
const { makeTestnet, tmpDir } = require('./helpers')

test('pairing: candidate request reaches the creator', async function (t) {
  t.plan(4)
  const tn = await makeTestnet(t)

  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const invite = await creator.createInvite()
  t.is(typeof invite, 'string')

  const joiner = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap
  })
  await joiner.ready()
  t.teardown(() => joiner.close())

  creator.on('pairing-request', ({ candidateKey, name }) => {
    t.is(candidateKey, joiner.deviceKey)
    t.is(name, 'phone')
  })

  joiner.joinGroup(invite).catch(() => {}) // resolves only after Task 5's approve
  t.is(joiner.groupStatus, 'joining')
})

test('pairing: createInvite is idempotent until consumed', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({
    storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap
  })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())

  const a = await creator.createInvite()
  const b = await creator.createInvite()
  t.is(a, b, 'outstanding invite is reused, not multiplied')
})
