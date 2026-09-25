const test = require('brittle')
const WallpaperCore = require('../../../index.js')
const { makeTestnet, tmpDir } = require('../../helpers')

test('second core on the same storageDir while the first is open', async function (t) {
  const tn = await makeTestnet(t)
  const dir = await tmpDir(t)
  const a = new WallpaperCore({ storageDir: dir, deviceName: 'bg-round', bootstrap: tn.bootstrap })
  await a.ready()
  await a.createGroup()
  t.teardown(() => a.close())
  const b = new WallpaperCore({ storageDir: dir, deviceName: 'ui', bootstrap: tn.bootstrap })
  try {
    await b.ready()
    console.log('second core opened; groupStatus =', b.groupStatus)
    await b.close()
  } catch (err) {
    console.log('second core ready() rejected:', err.message)
  }
  t.pass()
})
