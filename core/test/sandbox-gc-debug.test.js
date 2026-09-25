const test = require('brittle')
const b4a = require('b4a')
const { k } = require('../lib/apply.js')
const { pairedDuo, until } = require('./helpers')

function fakePng(size = 4096) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

for (const mode of ['both clear', 'only sender clears', 'only target clears', 'nobody clears']) {
  test('debug: ' + mode, async function (t) {
    t.timeout(120000)
    const { creator: a, joiner: b } = await pairedDuo(t)
    if (mode === 'only target clears' || mode === 'nobody clears') a.blobs.clear = async () => {}
    if (mode === 'only sender clears' || mode === 'nobody clears') b.blobs.clear = async () => {}
    for (let i = 0; i < 12; i++) {
      const t0 = Date.now()
      const { id } = await a.sendWallpaper(fakePng(1024 + i), [b.deviceKey])
      const blob = (await a.base.view.get(k.send(id))).value.blob
      try {
        await until(b, 'update', async () => {
          const e = await b.pendingWallpaper()
          return e !== null && e.id === id
        }, 10000)
        t.comment(`send ${i} materialized on b in ${Date.now() - t0} ms`)
      } catch (err) {
        t.comment(`send ${i} FAILED: ${err.message}`)
        t.comment(`  b has view send: ${(await b.base.view.get(k.send(id))) !== null}`)
        t.comment(`  a holds blob: ${await a.blobs.has(blob)} b holds: ${await b.blobs.has(blob)}`)
        t.comment(`  a blobs core length=${a.blobs.local.core.length} contiguous=${a.blobs.local.core.contiguousLength}`)
        const rb = await b.blobs._blobs(blob)
        t.comment(`  b remote session length=${rb.core.length} contiguous=${rb.core.contiguousLength} peers=${rb.core.peers.length}`)
        t.comment(`  b _receiveGate=${JSON.stringify(b._receiveGate)} relayGate=${JSON.stringify(b._relayGate)} materializing=${[...b._materializing.keys()].length}`)
        const got = await b.blobs.get(blob, { timeoutMs: 5000 }).then((x) => 'ok ' + x.byteLength, (e) => 'ERR ' + e.message)
        t.comment(`  direct b.blobs.get: ${got}`)
        const pend = await b.pendingWallpaper()
        t.comment(`  pendingWallpaper: ${pend && pend.id.slice(0, 8)}`)
        t.fail(mode)
        return
      }
      await b.markApplied(id)
    }
    t.pass(mode)
  })
}
