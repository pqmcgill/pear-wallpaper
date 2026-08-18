const test = require('brittle')
const b4a = require('b4a')
const { pairedDuo } = require('./helpers')

test('blobs: bytes written on one device are fetchable on another by ref only', async function (t) {
  const { creator, joiner } = await pairedDuo(t)

  const payload = b4a.alloc(1024 * 1024, 0xab) // 1 MiB
  const ref = await creator.blobs.put(payload)
  t.is(typeof ref.core, 'string')

  const fetched = await joiner.blobs.get(ref)
  t.is(fetched.byteLength, payload.byteLength)
  t.ok(b4a.equals(fetched, payload))
})
