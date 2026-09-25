// Receive-side size cap and disk growth: the 20 MB cap and image sniff run
// only on the sender. A member appending a set-wallpaper by hand ships any
// size, any bytes, and every online member (targets AND relays) fetches it.
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const { trio, until } = require('../../helpers.js')
const { tinyPng, sleep } = require('./_util.js')

function du(dir) { return execSync(`du -sk "${dir}" | cut -f1`).toString().trim() + ' KB' }
function mb(n) { return (n / 1048576).toFixed(1) + ' MB' }

test('bigblob: 64 MB non-image from a member is fetched by the target and the relay, fully buffered', async function (t) {
  t.timeout(180000)
  const { a, b, c } = await trio(t)
  const SIZE = 64 * 1024 * 1024
  const big = crypto.randomBytes(SIZE)
  const blob = await b.blobs.put(big)
  t.comment('before: du a=' + du(a.storageDir) + ' b=' + du(b.storageDir) + ' c=' + du(c.storageDir))
  if (global.gc) global.gc()
  const m0 = process.memoryUsage()
  const t0 = Date.now()
  await b.base.append({
    type: 'set-wallpaper', id: 'big1', from: b.deviceKey,
    targets: [a.deviceKey], blob, meta: { ext: '.png', byteLength: 12, filename: null }, sentAt: Date.now()
  })
  let got = null
  a.on('wallpaper', (w) => { got = w })
  await until(a, 'update', () => got !== null, 150000)
  const t1 = Date.now()
  const m1 = process.memoryUsage()
  t.comment(`target a materialized in ${t1 - t0} ms; file=${mb(fs.statSync(got.filePath).size)} at ${got.filePath}`)
  t.comment(`process delta while materializing: rss ${mb(m1.rss - m0.rss)} external ${mb(m1.external - m0.external)} arrayBuffers ${mb(m1.arrayBuffers - m0.arrayBuffers)}`)
  t.is(fs.statSync(got.filePath).size, SIZE, 'target wrote all 64 MB (no receive-side cap, meta.byteLength said 12)')
  // relay: c is neither sender nor target
  await until(c, 'update', () => c.blobs.has(blob), 150000)
  t.comment('after : du a=' + du(a.storageDir) + ' b=' + du(b.storageDir) + ' c=' + du(c.storageDir))
  t.ok(await c.blobs.has(blob), 'relay c downloaded the full 64 MB blob too')
})

test('growth: blobs and received files are never garbage collected', async function (t) {
  t.timeout(180000)
  const { a, b, c } = await trio(t)
  const ONE_MB = b4a.concat([tinyPng(0), crypto.randomBytes(1024 * 1024)])
  t.comment('before: du a=' + du(a.storageDir) + ' b=' + du(b.storageDir) + ' c=' + du(c.storageDir))
  const N = 10
  for (let i = 0; i < N; i++) {
    const { id } = await a.sendWallpaper(ONE_MB, [b.deviceKey])
    let got = null
    const h = (w) => { if (w.id === id) got = w }
    b.on('wallpaper', h)
    await until(b, 'update', () => got !== null, 30000)
    b.off('wallpaper', h)
    await b.markApplied(id)
  }
  await until(c, 'update', async () => {
    for await (const n of c.base.view.createReadStream({ gte: 'send/', lt: 'send0' })) if (!(await c.blobs.has(n.value.blob))) return false
    return true
  }, 60000).catch(() => {})
  const received = fs.readdirSync(path.join(b.storageDir, 'received'))
  t.comment(`after ${N} x 1 MB sends a->b, all acked by b:`)
  t.comment('  du a=' + du(a.storageDir) + ' b=' + du(b.storageDir) + ' c(relay, not a target)=' + du(c.storageDir))
  t.comment('  b/received has ' + received.length + ' files, ' + du(path.join(b.storageDir, 'received')))
  t.comment('  b listReceived({limit:10}) rows=' + (await b.listReceived()).length)
  t.ok(received.length === N)
})
