const test = require('brittle')
const b4a = require('b4a')
const path = require('path')
const { pairedDuo, until } = require('../../helpers')
const { createBridgeMain } = require('../../../../bridge/bridge-main.js')
const { createApplyController } = require(path.join(__dirname, '../../../../android/lib/apply-controller.js'))

function fakePng(size) {
  const buf = b4a.alloc(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

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

test('resident controller + background nudge controller on one bridge apply the same send twice', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const sent = await creator.sendWallpaper(fakePng(4096), [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.pendingWallpaper()) !== null)

  const bridge = directBridge(joiner)
  const calls = []
  // setStream is a real disk write + wallpaper-service round trip; ~300ms is conservative
  const setter = async (filePath) => { calls.push(path.basename(filePath)); await new Promise((r) => setTimeout(r, 300)) }

  // _layout.js's long-lived controller (triggered by the 'state' push syncNow causes)
  const resident = createApplyController({ bridge, setter })
  // background-sync.js's nudge path builds its own controller after syncNow resolves
  const nudge = createApplyController({ bridge, setter })
  const p1 = resident.applyPending()
  await new Promise((r) => setTimeout(r, 50))
  const p2 = nudge.applyPending()
  await Promise.all([p1, p2])

  let ackOps = 0
  for (let i = 0; i < joiner.base.local.length; i++) {
    const node = await joiner.base.local.get(i)
    const v = node && node.value
    if (v && v.type === 'applied' && v.sendId === sent.id) ackOps++
  }
  console.log('send id:', sent.id)
  console.log('setter calls:', calls)
  console.log('applied ops appended for this send:', ackOps)
  t.is(calls.length, 1, 'wallpaper set exactly once')
})
