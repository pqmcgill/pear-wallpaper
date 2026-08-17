const test = require('brittle')
const WallpaperCore = require('../index.js')
const { tmpDir } = require('./helpers')

test('lifecycle: identity is stable across reopen', async function (t) {
  const dir = await tmpDir(t)

  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'test-mac' })
  await core1.ready()
  const key1 = core1.deviceKey
  t.is(typeof key1, 'string')
  t.is(key1.length, 64)
  t.is(core1.groupStatus, 'none')
  t.is(core1.deviceName, 'test-mac')
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'test-mac' })
  await core2.ready()
  t.is(core2.deviceKey, key1, 'same storage, same identity')
  await core2.close()
})

test('lifecycle: local meta persists', async function (t) {
  const dir = await tmpDir(t)
  const core1 = new WallpaperCore({ storageDir: dir, deviceName: 'x' })
  await core1.ready()
  await core1.meta.put('probe', { hello: 1 })
  await core1.close()

  const core2 = new WallpaperCore({ storageDir: dir, deviceName: 'x' })
  await core2.ready()
  t.alike(await core2.meta.get('probe'), { hello: 1 })
  t.is(await core2.meta.get('missing'), null)
  await core2.close()
})
