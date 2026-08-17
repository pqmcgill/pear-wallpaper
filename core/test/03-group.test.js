const test = require('brittle')
const WallpaperCore = require('../index.js')
const { tmpDir, until } = require('./helpers')

test('createGroup: creator appears in its own roster', async function (t) {
  const core = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'alpha' })
  await core.ready()
  t.teardown(() => core.close())

  await core.createGroup()
  t.is(core.groupStatus, 'member')

  const devices = await core.listDevices()
  t.is(devices.length, 1)
  t.is(devices[0].key, core.deviceKey)
  t.is(devices[0].name, 'alpha')
  t.is(devices[0].isSelf, true)
  t.is(devices[0].isCreator, true)
})

test('createGroup: group survives reopen', async function (t) {
  const dir = await tmpDir(t)
  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'alpha' })
  await core1.ready()
  await core1.createGroup()
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'alpha' })
  await core2.ready()
  t.is(core2.groupStatus, 'member', 'reopen restores membership')
  const devices = await core2.listDevices()
  t.is(devices.length, 1)
  t.is(devices[0].name, 'alpha')
  await core2.close()
})

test('createGroup: cannot create twice', async function (t) {
  const core = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'alpha' })
  await core.ready()
  t.teardown(() => core.close())
  await core.createGroup()
  await t.exception(() => core.createGroup(), /already/)
})
