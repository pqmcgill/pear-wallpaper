const test = require('brittle')
const b4a = require('b4a')
const path = require('path')
const { pairedDuo, until } = require('../../helpers')
const { createBridgeMain } = require('../../../../bridge/bridge-main.js')
const { createApplyController } = require(path.join(__dirname, '../../../../android/lib/apply-controller.js'))

function fakePng(size, marker) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf[100] = marker
  return buf
}

// In-process bridge: the real bridge-main command table, called directly.
function directBridge(core) {
  const sent = []
  const transport = { send: (m) => sent.push(m), onMessage: (cb) => { transport.cb = cb } }
  createBridgeMain({ core, transport }).start()
  let id = 0
  return {
    call(cmd, ...args) {
      const myId = ++id
      transport.cb({ t: 'req', id: myId, cmd, args })
      return new Promise((resolve, reject) => {
        const tick = () => {
          const res = sent.find((m) => m.t === 'res' && m.id === myId)
          if (!res) return setTimeout(tick, 5)
          res.ok ? resolve(res.value) : reject(new Error(res.error))
        }
        tick()
      })
    }
  }
}

test('android apply controller ends on the OLDER wallpaper after an offline backlog of two sends', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const older = await creator.sendWallpaper(fakePng(4096, 1), [joiner.deviceKey])
  const newer = await creator.sendWallpaper(fakePng(8192, 2), [joiner.deviceKey])

  await until(joiner, 'update', async () => {
    const e = await joiner.pendingWallpaper()
    return e !== null && e.id === newer.id
  })

  const applied = []
  const setter = async (filePath, target) => { applied.push(path.basename(filePath)) }
  const controller = createApplyController({ bridge: directBridge(joiner), setter })
  await controller.applyPending()

  console.log('older id:', older.id)
  console.log('newer id:', newer.id)
  console.log('setter calls in order:', applied)
  const last = applied[applied.length - 1]
  t.ok(last.startsWith(newer.id), 'final wallpaper on screen is the newest send')
})
