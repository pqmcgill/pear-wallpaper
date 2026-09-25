const test = require('brittle')
const WallpaperCore = require('../../../index.js')
const { makeTestnet, tmpDir } = require('../../helpers')

test('clean close() during a pending join drops the persisted pending-invite', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const invite = await creator.createInvite()

  const dir = await tmpDir(t)
  const joiner = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner.ready()
  const p = joiner.joinGroup(invite)
  p.catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  t.is(joiner.groupStatus, 'joining')
  t.is((await joiner.meta.get('pending-invite')).invite, invite, 'persisted while in flight')
  await joiner.close()

  const joiner2 = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner2.ready()
  t.teardown(() => joiner2.close())
  const pending = await joiner2.meta.get('pending-invite')
  t.comment('pending-invite after clean close + reopen: ' + JSON.stringify(pending))
  t.ok(pending !== null, 'pending-invite survives a clean close so restart can resume')
  await new Promise((r) => setTimeout(r, 200))
  t.comment('groupStatus after reopen: ' + joiner2.groupStatus)
  t.is(joiner2.groupStatus, 'joining', 'join resumed on restart')
})

test('groupStatus right after ready() on a resumed join', async function (t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const invite = await creator.createInvite()

  const dir = await tmpDir(t)
  const joiner = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner.ready()
  await joiner.meta.put('pending-invite', { invite }) // simulate a crash mid-join
  await joiner.close()

  const joiner2 = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner2.ready()
  t.teardown(() => joiner2.close())
  const immediate = joiner2.groupStatus
  await new Promise((r) => setTimeout(r, 0))
  const afterTick = joiner2.groupStatus
  t.comment(`groupStatus immediately after ready(): ${immediate}; one tick later: ${afterTick}`)
  t.is(immediate, 'joining', 'README: joining while a join resumed on restart is in flight')
})
