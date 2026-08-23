// Task 9: the bounded background round — driven headless from
// expo-task-manager, never concurrent with the resident worklet
// (single-writer corestore). Mocks react-native-bare-kit the same way
// worklet-client.test.js does; mocks the native setter and settings so
// this runs under plain jest with no native modules.
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

// worklet-client.js is mocked wholesale here (unlike worklet-client.test.js,
// which tests the real module) — background-sync.js only needs its
// isActive()/getBridge() surface, and the guard test specifically wants
// isActive() controllable independent of any real Worklet lifecycle.
jest.mock('../lib/worklet-client', () => ({
  isActive: jest.fn(() => false),
  getBridge: jest.fn()
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

function sendFrame (ipc, msg) {
  ipc.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
}

function readWritten (ipc, index) {
  return JSON.parse(ipc.written[index])
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

  const items = [{ id: 'a', filePath: '/f/a.png' }]
  await answerReqs(w, (req, worklet) => {
    if (req.cmd === 'syncNow') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: null })
    } else if (req.cmd === 'pendingWallpaper') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: items.shift() || null })
    } else if (req.cmd === 'markApplied') {
      sendFrame(worklet.IPC, { t: 'res', id: req.id, ok: true, value: true })
    }
  })

  // Advance the bounded shutdown-linger timer inside runBoundedSyncRound.
  await jest.advanceTimersByTimeAsync(2000)

  const result = await roundPromise
  expect(result).toBe('synced')
  expect(setWallpaper).toHaveBeenCalledWith('/f/a.png', 'home')

  const frames = w.IPC.written.map((s) => JSON.parse(s))
  expect(frames.find((m) => m.t === 'shutdown')).toBeTruthy()
  expect(w.terminated).toBe(true)

  jest.useRealTimers()
})

test('init failure (terminal error before ready) rejects the round without hanging', async () => {
  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  const roundPromise = runBoundedSyncRound()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'init failed: boom' } })

  await expect(roundPromise).rejects.toThrow('init failed: boom')
})

test('guard: when the resident worklet isActive(), the round nudges it instead of constructing a Worklet', async () => {
  const workletClient = require('../lib/worklet-client')
  workletClient.isActive.mockReturnValue(true)
  const calls = []
  const fakeBridge = {
    call: jest.fn(async (cmd, ...args) => {
      calls.push([cmd, ...args])
      if (cmd === 'pendingWallpaper') return null
      return true
    })
  }
  workletClient.getBridge.mockReturnValue(fakeBridge)

  const { runBoundedSyncRound } = require('../lib/background-sync')
  const { __instances } = require('react-native-bare-kit')

  const result = await runBoundedSyncRound()

  expect(result).toBe('nudged-resident')
  expect(__instances).toHaveLength(0) // no second Worklet constructed
  expect(calls.some((c) => c[0] === 'syncNow')).toBe(true)
  expect(calls.some((c) => c[0] === 'pendingWallpaper')).toBe(true)
})
