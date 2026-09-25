const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const WallpaperCore = require('../index.js')
const { k } = require('../lib/apply.js')
const { pairedDuo, trio, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

// Random so nothing on the way to disk can compress it away.
function bigPng(bytes) {
  return b4a.concat([fakePng(8), crypto.randomBytes(bytes)])
}

function du(dir) {
  try {
    return execSync(`du -sk "${dir}" | cut -f1`).toString().trim() + ' KB'
  } catch {
    return '?'
  }
}

function receivedFiles(core) {
  return fs.readdirSync(path.join(core.storageDir, 'received')).sort()
}

function fileOf(core, id) {
  return path.join(core.storageDir, 'received', id + '.png')
}

async function blobOf(core, id) {
  return (await core.base.view.get(k.send(id))).value.blob
}

// Wait for the newest send to reach `peer`, then ack it, the way a shell does.
async function applyOn(peer, id) {
  await until(peer, 'update', async () => {
    const e = await peer.pendingWallpaper()
    return e !== null && e.id === id
  })
  await peer.markApplied(id)
}

// #10 regression, the review's growth repro. Before: 10 x 1 MB sent and
// ~44 MB stored across three devices, none of it ever freed. A blob is
// needed only until every target applied it (or applied something newer),
// after which the sender, the target and every relay clear their copy.
// The target keeps the file it applied, so storage converges to one copy.
// C1's follow-up. The relay sweep fetched every send that lacked an ack
// from every target, so a send superseded for its only target (the target
// applied a newer one) was fetched and held forever by every member.
// b's sweep is held while two sends to c land and c applies the newer, so
// by the time b sweeps, the view already says nobody needs either.
test('gc: a send superseded or applied for every target is never relayed', async function (t) {
  const { a, b, c } = await trio(t)
  const sweep = b._relayOnce.bind(b)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  b._relayOnce = async () => { await gate; return sweep() }
  const get = b.blobs.get.bind(b.blobs)
  const fetched = []
  b.blobs.get = (ref, opts) => { fetched.push(ref.id.blockOffset); return get(ref, opts) }

  const first = await a.sendWallpaper(fakePng(), [c.deviceKey])
  const second = await a.sendWallpaper(fakePng(8192), [c.deviceKey])
  await applyOn(c, second.id)
  const third = await a.sendWallpaper(fakePng(2048), [c.deviceKey])
  const blobs = { first: await blobOf(a, first.id), second: await blobOf(a, second.id), third: await blobOf(a, third.id) }

  await until(a, 'update', async () => !(await a.blobs.has(blobs.first)) && !(await a.blobs.has(blobs.second)), 15000).catch(() => {})
  t.absent(await a.blobs.has(blobs.first), 'sender cleared the superseded send')
  t.absent(await a.blobs.has(blobs.second), 'sender cleared the applied send')
  t.ok(await a.blobs.has(blobs.third), 'sender keeps the send nobody applied yet')

  await until(b, 'update', async () => (await b.base.view.get(k.ack(second.id, c.deviceKey))) !== null)
  await until(b, 'update', async () => (await b.base.view.get(k.send(third.id))) !== null)
  release()
  await until(b, 'update', () => b.blobs.has(blobs.third), 15000).catch(() => {})
  t.ok(await b.blobs.has(blobs.third), 'relay holds the send nobody applied yet')
  t.alike(fetched, [blobs.third.id.blockOffset], 'relay fetched only that one')
})

// Files are the Received list: the newest 10 applied wallpapers stay on
// disk, and listReceived never lists a row whose file is gone.
test('gc: received/ keeps the newest 10 files and listReceived lists exactly those', async function (t) {
  t.timeout(60000)
  const { creator, joiner } = await pairedDuo(t)
  const ids = []
  for (let i = 0; i < 12; i++) {
    const { id } = await creator.sendWallpaper(fakePng(1024 + i), [joiner.deviceKey])
    ids.push(id)
    await applyOn(joiner, id)
  }

  await until(joiner, 'update', () => receivedFiles(joiner).length === 10, 15000).catch(() => {})
  const files = receivedFiles(joiner)
  t.alike(files, ids.slice(2).map((id) => id + '.png').sort(), 'the two oldest files are gone')

  const rows = await joiner.listReceived({ limit: 50 })
  t.alike(rows.map((r) => r.id), ids.slice(2).reverse(), 'listReceived reports only what is on disk, newest first')
  for (const row of rows) t.ok(fs.existsSync(row.filePath), 'listed file exists: ' + row.id.slice(0, 8))
})

// The one file the OS is showing is always kept. A shell applies the
// pending wallpaper from its file and only then acks; until that ack the
// send has no place in the applied list, so it is protected on its own.
test('gc: a wallpaper the shell is still applying keeps its file until acked', async function (t) {
  t.timeout(60000)
  const { creator, joiner } = await pairedDuo(t)
  const ids = []
  for (let i = 0; i < 10; i++) {
    const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
    ids.push(id)
    await applyOn(joiner, id)
  }
  const { id: pending } = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])
  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === pending
  })
  await joiner._relayBlobs()
  t.ok(fs.existsSync(fileOf(joiner, pending)), 'pending file survives a sweep')
  t.is(receivedFiles(joiner).length, 11, '10 applied files plus the pending one')

  await joiner.markApplied(pending)
  await until(joiner, 'update', () => !fs.existsSync(fileOf(joiner, ids[0])), 15000).catch(() => {})
  t.absent(fs.existsSync(fileOf(joiner, ids[0])), 'the ack evicts the oldest applied file')
  t.ok(fs.existsSync(fileOf(joiner, pending)), 'the newly applied file is kept')
  t.is(receivedFiles(joiner).length, 10)
})

// A send materialized but never acked (a newer one arrived first, and
// newest wins) will never be applied: its file goes too.
test('gc: a materialized send retired by a newer one loses its file', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const first = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === first.id
  })
  t.ok(fs.existsSync(fileOf(joiner, first.id)), 'first was materialized')

  const second = await creator.sendWallpaper(fakePng(8192), [joiner.deviceKey])
  await applyOn(joiner, second.id)

  await until(joiner, 'update', () => !fs.existsSync(fileOf(joiner, first.id)), 15000).catch(() => {})
  t.absent(fs.existsSync(fileOf(joiner, first.id)), 'retired file is gone')
  t.ok(fs.existsSync(fileOf(joiner, second.id)), 'applied file stays')
  t.alike((await joiner.listReceived()).map((r) => r.id), [second.id])
})

// Idempotent pass: a device that never got to sweep (crash, kill) converges
// on its own at the next open, with no peer online to trigger an update.
test('gc: storage converges on reopen', async function (t) {
  t.timeout(60000)
  const { creator, joiner } = await pairedDuo(t)
  joiner._relayOnce = async () => {} // no sweeps this session
  const blobs = []
  for (let i = 0; i < 12; i++) {
    const { id } = await creator.sendWallpaper(fakePng(), [joiner.deviceKey])
    blobs.push(await blobOf(creator, id))
    await applyOn(joiner, id)
  }
  t.is(receivedFiles(joiner).length, 12, 'nothing pruned while sweeps were off')
  let held = 0
  for (const blob of blobs) if (await joiner.blobs.has(blob)) held++
  t.is(held, 12, 'nothing cleared while sweeps were off')

  const dir = joiner.storageDir
  const bootstrap = joiner.bootstrap
  await joiner.close()
  await creator.close()

  const joiner2 = new WallpaperCore({ storageDir: dir, deviceName: 'phone', bootstrap })
  await joiner2.ready()
  t.teardown(() => joiner2.close())
  await until(joiner2, 'update', async () => {
    if (receivedFiles(joiner2).length !== 10) return false
    for (const blob of blobs) if (await joiner2.blobs.has(blob)) return false
    return true
  }, 15000).catch(() => {})
  t.is(receivedFiles(joiner2).length, 10, 'files pruned on open')
  held = 0
  for (const blob of blobs) if (await joiner2.blobs.has(blob)) held++
  t.is(held, 0, 'applied blobs cleared on open')
  const rows = await joiner2.listReceived()
  t.is(rows.length, 10)
  for (const row of rows) t.ok(fs.existsSync(row.filePath), 'listed file exists: ' + row.id.slice(0, 8))
})
