jest.mock('react-native-bare-kit', () => {
  const { EventEmitter } = require('events')
  const instances = []
  class Worklet {
    constructor () {
      this.IPC = new EventEmitter()
      this.IPC.written = []
      this.IPC.write = (buf) => this.IPC.written.push(Buffer.from(buf).toString())
      instances.push(this)
    }

    start (path, source) { this.started = { path, source } }
  }
  return { Worklet, __instances: instances }
})
jest.mock('expo-device', () => ({ modelName: 'Pixel Test' }))
// expo-file-system SDK 55: Paths.document is a Directory whose .uri is a
// file:// URI (Android native constant is `Uri.fromFile(context.filesDir)`)
// — worklet-client.js strips the scheme to get a plain fs path for the
// Bare-side corestore.
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///data/user/0/com.pearwallpaper.app/files/' } }
}))
// bare-pack's --out .../worklet.bundle.mjs is an ES module whose default
// export is the raw bundle source string (see bare-pack README's "bundle
// format" table); mocked virtual since it's gitignored build output.
jest.mock('../app/gen/worklet.bundle.mjs', () => ({ __esModule: true, default: 'fake-bundle-source' }), { virtual: true })

// Each test gets a fresh module registry: worklet-client.js's `instance`
// singleton and the mocked react-native-bare-kit's `__instances` array are
// both module-level state that would otherwise leak between tests (and the
// readiness-queue tests below specifically need a worklet that has NOT
// already seen a 'ready' evt from some earlier test).
beforeEach(() => {
  jest.resetModules()
})

function load () {
  const { getBridge, isActive } = require('../lib/worklet-client')
  const { __instances } = require('react-native-bare-kit')
  return { getBridge, isActive, __instances }
}

function sendFrame (ipc, msg) {
  ipc.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
}

function readWritten (ipc, index) {
  return JSON.parse(ipc.written[index])
}

test('first frame is init with storageDir + deviceName; singleton thereafter', () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  const first = readWritten(w.IPC, 0)
  expect(first.t).toBe('init')
  expect(first.deviceName).toBe('Pixel Test')
  expect(first.storageDir).toMatch(/pear-wallpaper/)
  expect(getBridge()).toBe(bridge) // single-writer rule, enforcement point 1
  expect(__instances).toHaveLength(1)
})

test('storageDir has no leftover file:// scheme from the Paths.document URI', () => {
  const { getBridge, __instances } = load()
  getBridge()
  const w = __instances[0]
  const first = readWritten(w.IPC, 0)
  expect(first.storageDir).not.toMatch(/file:/)
  expect(first.storageDir).toBe('/data/user/0/com.pearwallpaper.app/files/pear-wallpaper')
})

test('a terminal error (arriving before ready, i.e. a failed init) clears the singleton so the next getBridge() starts a fresh worklet', () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  // Simulate the host's init-failure frame (worklet/host.js) arriving over
  // the wire before any 'ready' evt for this instance.
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'boom' } })

  const nextBridge = getBridge()
  expect(nextBridge).not.toBe(bridge)
  expect(__instances).toHaveLength(2)
})

test('an error arriving after ready is a normal operational error, not terminal — singleton survives', () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'auto-resume join failed' } })

  expect(getBridge()).toBe(bridge)
  expect(__instances).toHaveLength(1)
})

// --- post-Task-6 ruled fix: readiness gate on bridge.call() -----------
//
// worklet/host.js only wires bridge-main's 'req' handler after core.ready()
// resolves; the newline-JSON transport has no queueing. A bridge.call()
// sent before the host's 'ready' evt used to go straight onto the wire and
// be silently dropped, leaving its promise unsettled forever (the cold-
// start getState drop diagnosed during Task 6). These three tests cover
// the fix: queue-then-replay, pass-through-after-ready, and reject-queued-
// calls-on-terminal-error.

test('a call made before ready does not hit the transport until ready fires, then resolves with the real response', async () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  const writtenBeforeCall = w.IPC.written.length // just the init frame so far

  const callPromise = bridge.call('getState')

  // Not on the wire yet — the host isn't listening for 'req' frames
  // before 'ready', so sending now would be silently dropped.
  expect(w.IPC.written).toHaveLength(writtenBeforeCall)

  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  // 'ready' replays the queued call as a real req frame.
  expect(w.IPC.written).toHaveLength(writtenBeforeCall + 1)
  const req = readWritten(w.IPC, writtenBeforeCall)
  expect(req.t).toBe('req')
  expect(req.cmd).toBe('getState')

  sendFrame(w.IPC, { t: 'res', id: req.id, ok: true, value: { groupStatus: 'member' } })

  await expect(callPromise).resolves.toEqual({ groupStatus: 'member' })
})

test('calls made after ready pass through immediately, with no queueing', async () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  const writtenBeforeCall = w.IPC.written.length
  const callPromise = bridge.call('syncNow')

  expect(w.IPC.written).toHaveLength(writtenBeforeCall + 1)
  const req = readWritten(w.IPC, writtenBeforeCall)
  expect(req.cmd).toBe('syncNow')

  sendFrame(w.IPC, { t: 'res', id: req.id, ok: true, value: null })

  await expect(callPromise).resolves.toBeNull()
})

// --- Task 9: isActive() — the single-writer guard background-sync.js
// consults before deciding whether to nudge the resident worklet instead
// of opening a second one. -------------------------------------------

test('isActive() is false before any getBridge() call', () => {
  const { isActive } = load()
  expect(isActive()).toBe(false)
})

test('isActive() is true as soon as getBridge() constructs the resident worklet — existence, not readiness, is the guard (a not-yet-ready worklet is still safely nudgeable via the queue-until-ready bridge)', () => {
  const { getBridge, isActive } = load()
  getBridge()
  expect(isActive()).toBe(true) // true even before any 'ready' evt arrives
})

test('isActive() stays true once the resident worklet has reached ready', () => {
  const { getBridge, isActive, __instances } = load()
  getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
  expect(isActive()).toBe(true)
})

test('isActive() goes back to false after a terminal (pre-ready) error clears the singleton', () => {
  const { getBridge, isActive, __instances } = load()
  getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'boom' } })
  expect(isActive()).toBe(false)
})

test('a terminal error before ready rejects any queued call and still clears the singleton', async () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]

  const callPromise = bridge.call('getState')
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'init failed: boom' } })

  await expect(callPromise).rejects.toThrow('init failed: boom')
  expect(getBridge()).not.toBe(bridge)
  expect(__instances).toHaveLength(2)
})
