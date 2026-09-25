const test = require('brittle')
const EventEmitter = require('events')
const { createWorkerSupervisor } = require('../lib/worker-supervisor.js')

function fakePipe () {
  const p = new EventEmitter()
  p.written = []
  p.destroyed = false
  p.write = (buf) => { p.written.push(JSON.parse(buf.toString('utf8'))) }
  p.destroy = () => { p.destroyed = true }
  p.die = (code = null, signal = 'SIGKILL') => p.emit('exit', code, signal)
  return p
}

function fakeClock () {
  let t = 0
  let seq = 0
  const timers = new Map()
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id },
      clearTimeout: (id) => { timers.delete(id) }
    },
    advance (ms) {
      t += ms
      for (const [id, { fn, at }] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (at <= t && timers.has(id)) { timers.delete(id); fn() }
      }
    },
    pending: () => timers.size
  }
}

function setup (opts = {}) {
  const clock = fakeClock()
  const pipes = []
  const frames = []
  const statuses = []
  const sup = createWorkerSupervisor({
    spawn: () => { const p = fakePipe(); pipes.push(p); return p },
    onFrame: (msg) => frames.push(msg),
    onStatus: (s) => statuses.push(s),
    delays: [100, 200, 400],
    stableMs: 10000,
    graceMs: 2000,
    timers: clock.timers,
    now: clock.now,
    log: () => {},
    ...opts
  })
  return { sup, clock, pipes, frames, statuses }
}

test('relays newline-JSON frames from the worker, including ones split across chunks', async (t) => {
  const { sup, pipes, frames } = setup()
  sup.start()
  pipes[0].emit('data', Buffer.from('{"t":"evt","event":"state"}\n{"t":"res",'))
  pipes[0].emit('data', Buffer.from('"id":1}\n'))
  t.alike(frames, [{ t: 'evt', event: 'state' }, { t: 'res', id: 1 }])
})

test('an unexpected exit reports restarting, then respawns after the backoff delay', async (t) => {
  const { sup, clock, pipes, statuses } = setup()
  sup.start()
  pipes[0].die()
  t.is(sup.status, 'restarting')
  t.absent(sup.write({ t: 'req', id: 1 }), 'writes are refused while the worker is down')
  clock.advance(99)
  t.is(pipes.length, 1, 'no respawn before the delay')
  clock.advance(1)
  t.is(pipes.length, 2, 'respawned')
  t.is(sup.status, 'running')
  t.ok(sup.write({ t: 'req', id: 2 }))
  t.alike(pipes[1].written, [{ t: 'req', id: 2 }], 'writes reach the new worker')
  t.alike(statuses, ['running', 'restarting', 'running'])
})

test('a crash loop gives up after the last delay and reports failed', async (t) => {
  const { sup, clock, pipes, statuses } = setup()
  sup.start()
  for (const ms of [100, 200, 400]) { pipes.at(-1).die(); clock.advance(ms) }
  t.is(pipes.length, 4)
  pipes.at(-1).die()
  t.is(sup.status, 'failed')
  clock.advance(100000)
  t.is(pipes.length, 4, 'no further respawns')
  t.is(statuses.at(-1), 'failed')
})

test('a worker that ran long enough earns a fresh restart budget', async (t) => {
  const { sup, clock, pipes } = setup()
  sup.start()
  for (const ms of [100, 200]) { pipes.at(-1).die(); clock.advance(ms) }
  clock.advance(10000)
  pipes.at(-1).die()
  t.is(sup.status, 'restarting', 'the long-lived crash does not count against the old budget')
  clock.advance(99)
  t.is(pipes.length, 3, 'backoff restarted from the first delay')
  clock.advance(1)
  t.is(pipes.length, 4)
})

test('start() after failing relaunches the worker with a fresh budget', async (t) => {
  const { sup, clock, pipes } = setup()
  sup.start()
  for (const ms of [100, 200, 400]) { pipes.at(-1).die(); clock.advance(ms) }
  pipes.at(-1).die()
  t.is(sup.status, 'failed')
  sup.start()
  t.is(pipes.length, 5)
  t.is(sup.status, 'running')
  sup.start()
  t.is(pipes.length, 5, 'start() while running does not spawn a second worker')
  pipes.at(-1).die()
  t.is(sup.status, 'restarting')
})

test('stop() sends shutdown and resolves when the worker exits', async (t) => {
  const { sup, pipes, statuses } = setup()
  sup.start()
  let done = false
  const stopped = sup.stop().then(() => { done = true })
  t.alike(pipes[0].written, [{ t: 'shutdown' }])
  await Promise.resolve()
  t.absent(done, 'waits for the worker to exit')
  pipes[0].die(0, null)
  await stopped
  t.absent(pipes[0].destroyed)
  t.is(pipes.length, 1, 'a clean exit during stop is not restarted')
  t.is(statuses.at(-1), 'running', 'no restarting status on a clean stop')
})

test('stop() destroys the worker after the grace period if it never exits', async (t) => {
  const { sup, clock, pipes } = setup()
  sup.start()
  const stopped = sup.stop()
  clock.advance(2000)
  await stopped
  t.ok(pipes[0].destroyed)
})

test('stop() resolves at once when the worker is already dead, and cancels the pending restart', async (t) => {
  const { sup, clock, pipes } = setup()
  sup.start()
  pipes[0].die()
  let done = false
  await sup.stop().then(() => { done = true })
  t.ok(done)
  t.is(clock.pending(), 0, 'no timers left: neither a grace timer nor the restart')
  clock.advance(100000)
  t.is(pipes.length, 1, 'no respawn after stop')
})
