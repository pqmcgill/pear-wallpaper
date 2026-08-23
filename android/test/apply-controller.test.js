import { createApplyController } from '../lib/apply-controller'

function fakeBridge (queue) {
  const calls = []
  return {
    calls,
    call: jest.fn(async (cmd, ...args) => {
      calls.push([cmd, ...args])
      if (cmd === 'pendingWallpaper') return queue.shift() || null
      return true
    })
  }
}

test('applies every pending item: setter then markApplied, in order', async () => {
  const bridge = fakeBridge([{ id: 'a', filePath: '/f/a.jpg' }, { id: 'b', filePath: '/f/b.jpg' }])
  const setter = jest.fn(async () => true)
  await createApplyController({ bridge, setter, getTarget: () => 'home' }).applyPending()
  expect(setter.mock.calls).toEqual([['/f/a.jpg', 'home'], ['/f/b.jpg', 'home']])
  expect(bridge.calls.filter(c => c[0] === 'markApplied')).toEqual([['markApplied', 'a'], ['markApplied', 'b']])
})

test('setter failure leaves the item unacked (retried next trigger)', async () => {
  const bridge = fakeBridge([{ id: 'a', filePath: '/f/a.jpg' }])
  const setter = jest.fn(async () => { throw new Error('decode failed') })
  await createApplyController({ bridge, setter, getTarget: () => 'home' }).applyPending()
  expect(bridge.calls.some(c => c[0] === 'markApplied')).toBe(false)
})

test('concurrent triggers coalesce into one pass plus one queued rerun', async () => {
  let resolvePending
  const bridge = { call: jest.fn((cmd) => cmd === 'pendingWallpaper'
    ? new Promise((r) => { resolvePending = r })
    : Promise.resolve(true)) }
  const c = createApplyController({ bridge, setter: jest.fn(), getTarget: () => 'home' })
  const first = c.applyPending()
  c.applyPending(); c.applyPending()          // while first is in-flight
  resolvePending(null)
  await first
  await new Promise((r) => setImmediate(r))
  // one in-flight pass + exactly one queued rerun = 2 pendingWallpaper calls
  expect(bridge.call.mock.calls.filter(c => c[0] === 'pendingWallpaper')).toHaveLength(2)
})
