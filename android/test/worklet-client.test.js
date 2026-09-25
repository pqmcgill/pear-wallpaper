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
jest.mock('../modules/wallpaper-setter', () => ({ setWallpaper: jest.fn(async () => true) }))
jest.mock('../lib/settings', () => ({ getTarget: jest.fn(() => 'home') }))

// Each test gets a fresh module registry: worklet-client.js's `instance`
// singleton and the mocked react-native-bare-kit's `__instances` array are
// both module-level state that would otherwise leak between tests (and the
// readiness-queue tests below specifically need a worklet that has NOT
// already seen a 'ready' evt from some earlier test).
beforeEach(() => {
  jest.resetModules()
  jest.useRealTimers()
})

function load () {
  const { getBridge, leaseWorklet } = require('../lib/worklet-client')
  const { __instances } = require('react-native-bare-kit')
  const { setWallpaper } = require('../modules/wallpaper-setter')
  return { getBridge, leaseWorklet, setWallpaper, __instances }
}

function sendFrame (ipc, msg) {
  ipc.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
}

function readWritten (ipc, index) {
  return JSON.parse(ipc.written[index])
}

function frames (worklet, type) {
  return worklet.IPC.written.map((s) => JSON.parse(s)).filter((m) => m.t === type)
}

test('first frame is init with storageDir + deviceName; singleton thereafter', () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  const first = readWritten(w.IPC, 0)
  expect(first.t).toBe('init')
  expect(first.deviceName).toBe('Pixel Test')
  expect(first.storageDir).toMatch(/pear-wallpaper/)
  expect(getBridge()).toBe(bridge) // single-writer rule
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

// --- readiness gate on bridge.call() -----------------------------------
//
// worklet/host.js only wires bridge-main's 'req' handler after core.ready()
// resolves; the newline-JSON transport has no queueing. A bridge.call()
// sent before the host's 'ready' evt used to go straight onto the wire and
// be silently dropped, leaving its promise unsettled forever (the cold-
// start getState drop diagnosed during Task 6). These tests cover the gate:
// queue-then-replay, pass-through-after-ready, and reject-on-terminal-error
// for both queued and later calls.

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

test('a call made on a bridge after its terminal error rejects instead of queueing forever (#7)', async () => {
  const { getBridge, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'error', payload: { message: 'File descriptor could not be locked' } })

  // _layout.js keeps the bridge it got at mount; every later tap goes here.
  await expect(bridge.call('createGroup')).rejects.toThrow('File descriptor could not be locked')
  expect(w.IPC.written).toHaveLength(1) // the init frame only; nothing hit the wire
})

// --- leaseWorklet(): the bounded background round's handle, and the
// single-writer rule between it and the resident UI. -----------------

test('a lease with no worklet live starts one; release() shuts it down (shutdown frame, terminate after the linger) and the next getBridge() starts fresh', async () => {
  jest.useFakeTimers()
  const { getBridge, leaseWorklet, __instances } = load()
  const lease = leaseWorklet()
  const w = __instances[0]
  expect(lease.reused).toBe(false)
  expect(readWritten(w.IPC, 0).t).toBe('init')

  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
  await lease.ready

  const released = lease.release()
  expect(frames(w, 'shutdown')).toHaveLength(1)
  expect(w.terminated).toBe(false)
  await jest.advanceTimersByTimeAsync(2000)
  await released
  expect(w.terminated).toBe(true)
  await expect(lease.bridge.call('getState')).rejects.toThrow('worklet shut down')

  getBridge()
  expect(__instances).toHaveLength(2)
})

test('a lease while the resident worklet is live reuses it (no second Worklet) and release() leaves it running', async () => {
  const { getBridge, leaseWorklet, __instances } = load()
  const bridge = getBridge()
  const w = __instances[0]
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  const lease = leaseWorklet()
  expect(lease.reused).toBe(true)
  expect(lease.bridge).toBe(bridge)
  await lease.ready
  await lease.release()

  expect(__instances).toHaveLength(1)
  expect(frames(w, 'shutdown')).toHaveLength(0)
  expect(w.terminated).toBe(false)
})

test('getBridge() during a lease claims the leased worklet: release() hands it over instead of shutting it down (#7)', async () => {
  const { getBridge, leaseWorklet, __instances } = load()
  const lease = leaseWorklet()
  const w = __instances[0]

  const bridge = getBridge() // the app opens mid-round
  expect(__instances).toHaveLength(1)
  expect(bridge).toBe(lease.bridge)

  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
  await lease.ready
  await lease.release()

  expect(frames(w, 'shutdown')).toHaveLength(0)
  expect(w.terminated).toBe(false)
  const callPromise = bridge.call('getState')
  const req = readWritten(w.IPC, w.IPC.written.length - 1)
  sendFrame(w.IPC, { t: 'res', id: req.id, ok: true, value: { groupStatus: 'member' } })
  await expect(callPromise).resolves.toEqual({ groupStatus: 'member' })
})

test('getBridge() while a released worklet is still shutting down starts the next one but holds its init until the old one is terminated', async () => {
  jest.useFakeTimers()
  const { getBridge, leaseWorklet, __instances } = load()
  const lease = leaseWorklet()
  const old = __instances[0]
  sendFrame(old.IPC, { t: 'evt', event: 'ready', payload: {} })
  await lease.ready
  const released = lease.release()

  const bridge = getBridge() // the app opens during the shutdown linger
  const next = __instances[1]
  const callPromise = bridge.call('getState')
  // The old worklet still holds the corestore lock: no init frame yet, and
  // the call waits in the readiness queue.
  expect(next.IPC.written).toHaveLength(0)

  await jest.advanceTimersByTimeAsync(2000)
  await released
  expect(old.terminated).toBe(true)
  expect(readWritten(next.IPC, 0).t).toBe('init')

  sendFrame(next.IPC, { t: 'evt', event: 'ready', payload: {} })
  const req = readWritten(next.IPC, 1)
  expect(req.cmd).toBe('getState')
  sendFrame(next.IPC, { t: 'res', id: req.id, ok: true, value: { groupStatus: 'member' } })
  await expect(callPromise).resolves.toEqual({ groupStatus: 'member' })
})

// --- applyPending(): the one apply pass per worklet, and where its
// failures go. ----------------------------------------------------------

test('a setter failure during applyPending() reaches bridge error listeners with the friendly message, and the item stays unacked', async () => {
  const { getBridge, setWallpaper, __instances } = load()
  setWallpaper.mockImplementation(async () => { throw new Error('WallpaperManager.setStream returned 0') })
  const bridge = getBridge()
  const w = __instances[0]
  const errors = []
  bridge.on('error', (payload) => errors.push(payload))
  sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })

  const pass = bridge.applyPending()
  await Promise.resolve()
  const req = readWritten(w.IPC, 1)
  expect(req.cmd).toBe('pendingWallpaper')
  sendFrame(w.IPC, { t: 'res', id: req.id, ok: true, value: { id: 'a', filePath: '/f/a.png' } })
  await pass

  expect(setWallpaper).toHaveBeenCalledWith('/f/a.png', 'home')
  expect(errors).toEqual([{ message: "Couldn't set the new wallpaper: WallpaperManager.setStream returned 0" }])
  expect(frames(w, 'req').some((m) => m.cmd === 'markApplied')).toBe(false)
})
