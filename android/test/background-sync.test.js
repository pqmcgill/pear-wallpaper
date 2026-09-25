// The bounded background round, driven headless from expo-task-manager,
// against the real worklet-client.js (the single-writer enforcement point).
// Mocks react-native-bare-kit the same way worklet-client.test.js does;
// mocks the native setter and settings so this runs under plain jest with
// no native modules.
jest.mock('react-native-bare-kit', () => {
  const { EventEmitter } = require('events')
  const instances = []
  class Worklet {
    constructor () {
      this.IPC = new EventEmitter()
      this.IPC.written = []
      this.IPC.write = (buf) => this.IPC.written.push(Buffer.from(buf).toString())
      this.terminated = false
      instances.push(this)
    }

    start (path, source) { this.started = { path, source } }
    terminate () { this.terminated = true }
  }
  return { Worklet, __instances: instances }
})
jest.mock('expo-device', () => ({ modelName: 'Pixel Test' }))
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///data/user/0/com.pearwallpaper.app/files/' } }
}))
jest.mock('../app/gen/worklet.bundle.mjs', () => ({ __esModule: true, default: 'fake-bundle-source' }), { virtual: true })
jest.mock('../modules/wallpaper-setter', () => ({ setWallpaper: jest.fn(async () => true) }))
jest.mock('../lib/settings', () => ({ getTarget: jest.fn(() => 'home') }))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

function sendFrame (ipc, msg) {
  ipc.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
}

function readWritten (ipc, index) {
  return JSON.parse(ipc.written[index])
}

function frames (worklet, type) {
  return worklet.IPC.written.map((s) => JSON.parse(s)).filter((m) => m.t === type)
}

// Polls microtasks until any newly-written 'req' frames appear, answering
// each with `handler` — drives the async syncNow/pendingWallpaper/
// markApplied call chain without hardcoding exact frame counts or timing.
async function answerReqs (worklet, handler) {
  worklet._answered = worklet._answered || 0
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
    while (worklet.IPC.written.length > worklet._answered) {
      const req = readWritten(worklet.IPC, worklet._answered)
      worklet._answered++
      if (req.t === 'req') handler(req, worklet)
    }
  }
}

function answerRound (items) {
  return (req, worklet) => {
    if (req.cmd === 'syncNow') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: null })
    } else if (req.cmd === 'pendingWallpaper') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: items.shift() || null })
    } else if (req.cmd === 'markApplied') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: true })
    }
  }
}

test('a fresh round: init, ready, syncNow, drains pending via setter+markApplied, shutdown, terminate', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] })
  const { setWallpaper } = require('../modules/wallpaper-setter')
  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  const roundPromise = runBoundedSyncRound()
  const w = __instances[0]

  const init = readWritten(w.IPC, 0)
  expect(init.t).toBe('init')
  expect(init.storageDir).toMatch(/pear-wallpaper/)
  expect(init.deviceName).toBe('Pixel Test')

  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  await answerReqs(w, answerRound([{ id: 'a', filePath: '/f/a.png' }]))

  // Advance the bounded shutdown-linger timer inside release().
  await jest.advanceTimersByTimeAsync(2000)

  const result = await roundPromise
  expect(result).toBe('synced')
  expect(setWallpaper).toHaveBeenCalledWith('/f/a.png', 'home')

  expect(frames(w, 'shutdown')).toHaveLength(1)
  expect(w.terminated).toBe(true)
})

test('init failure (terminal error before ready) rejects the round AND still terminates the worklet (bounded shutdown runs on every exit path)', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] })
  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  const roundPromise = runBoundedSyncRound()
  // Attach the rejection assertion immediately (before driving fake
  // timers below) so the promise is never observably unhandled between
  // ticks — otherwise Node's unhandled-rejection tracking flags this test
  // as failed even though the rejection is deliberate and gets caught.
  const assertion = expect(roundPromise).rejects.toThrow('init failed: boom')
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'init failed: boom' } })

  // release()'s bounded shutdown-linger timer still has to elapse before
  // terminate() fires, even on this failure path.
  await jest.advanceTimersByTimeAsync(2000)

  await assertion
  expect(w.terminated).toBe(true)
})

test('a worklet that never emits ready or error times out (bounded, does not hang forever) and still terminates', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] })
  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  const roundPromise = runBoundedSyncRound()
  const assertion = expect(roundPromise).rejects.toThrow('worklet ready timed out')
  const w = __instances[0]
  // Deliberately never send 'ready' or 'error' on w.IPC.

  await jest.advanceTimersByTimeAsync(30000) // READY_TIMEOUT_MS
  await jest.advanceTimersByTimeAsync(2000) // shutdown linger

  await assertion
  expect(w.terminated).toBe(true)
  expect(frames(w, 'shutdown')).toHaveLength(1)
})

test('single-writer rule: when the resident worklet is live, the round nudges it over the same IPC instead of constructing a second Worklet, and leaves it running', async () => {
  const { setWallpaper } = require('../modules/wallpaper-setter')
  const { getBridge } = require('../lib/worklet-client')
  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  getBridge() // the app is alive
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  const roundPromise = runBoundedSyncRound()
  await answerReqs(w, answerRound([{ id: 'a', filePath: '/f/a.png' }]))

  expect(await roundPromise).toBe('nudged-resident')
  expect(__instances).toHaveLength(1)
  expect(setWallpaper).toHaveBeenCalledWith('/f/a.png', 'home')
  expect(frames(w, 'shutdown')).toHaveLength(0)
  expect(w.terminated).toBe(false)
})
