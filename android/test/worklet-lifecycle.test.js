// One Worklet and one apply pass per process (issues #7 and #8). These tests
// mount the real app/_layout.js with the real lib/worklet-client.js,
// lib/background-sync.js and lib/apply-controller.js, so the two entry
// points that can touch the worklet (the resident UI and a background round)
// are wired exactly as in production. Only native and expo modules are
// mocked.
import { render, act } from '@testing-library/react-native'

jest.mock('react-native-bare-kit', () => {
  const { EventEmitter } = require('events')
  const instances = []
  class Worklet {
    constructor () {
      this.IPC = new EventEmitter()
      this.IPC.written = []
      this.IPC.write = (buf) => {
        const frame = Buffer.from(buf).toString()
        this.IPC.written.push(frame)
        if (this.IPC.onWrite) this.IPC.onWrite(frame)
      }
      this.terminated = false
      instances.push(this)
    }

    start (path, source) { this.started = { path, source } }
    terminate () { this.terminated = true }
    suspend () {}
    resume () {}
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
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }), Slot: () => null }))
jest.mock('expo-share-intent', () => ({
  useShareIntent: () => ({ hasShareIntent: false, shareIntent: {}, resetShareIntent: jest.fn() })
}))
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }))
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  BackgroundTaskResult: { Success: 1, Failed: 2 }
}))

// Every module is required inside the test, after resetModules, so the
// Layout, the background round and worklet-client all share one module
// registry (and so one worklet-client singleton), as they do in the app.
// React itself is pinned to the copy the renderer imported above, since a
// second React in the fresh registry would break Layout's hooks.
const sharedReact = require('react')
beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  jest.doMock('react', () => sharedReact)
})

function load () {
  return {
    Layout: require('../app/_layout').default,
    runBoundedSyncRound: require('../lib/background-sync').runBoundedSyncRound,
    getBridge: require('../lib/worklet-client').getBridge,
    setWallpaper: require('../modules/wallpaper-setter').setWallpaper,
    __instances: require('react-native-bare-kit').__instances
  }
}

function sendFrame (ipc, msg) {
  ipc.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
}

// Stands in for worklet/host.js: answers every 'req' frame written to this
// worklet's IPC with handler(req)'s value, one microtask later.
function host (worklet, handler) {
  worklet.IPC.onWrite = (frame) => {
    const msg = JSON.parse(frame)
    if (msg.t !== 'req') return
    Promise.resolve().then(() => sendFrame(worklet.IPC, { t: 'res', id: msg.id, ok: true, value: handler(msg) }))
  }
}

function frames (worklet, type) {
  return worklet.IPC.written.map((s) => JSON.parse(s)).filter((m) => m.t === type)
}

async function flush () {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

const memberSnapshot = { groupStatus: 'member', roster: [], sends: [], received: [] }

test('#7: opening the app while a headless round holds the worklet reuses it: one Worklet, one init frame, and the UI keeps working after the round', async () => {
  const { Layout, runBoundedSyncRound, getBridge, __instances } = load()

  // WorkManager respawned the process headless; the round's worklet is
  // booting (init sent, no 'ready' yet) when the user taps the launcher icon.
  const round = runBoundedSyncRound()
  round.catch(() => {})
  const w = __instances[0]
  host(w, (req) => (req.cmd === 'getState' ? memberSnapshot : null))

  await render(<Layout />)

  expect(__instances).toHaveLength(1)
  expect(frames(w, 'init')).toHaveLength(1)

  await act(async () => {
    sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
    await flush()
  })

  await expect(round).resolves.toBe('synced')
  // The app claimed the worklet mid-round, so the round hands it over
  // instead of shutting it down.
  expect(frames(w, 'shutdown')).toHaveLength(0)
  expect(w.terminated).toBe(false)
  await expect(getBridge().call('getState')).resolves.toEqual(memberSnapshot)
})

test('#8: a background nudge during the resident apply pass sets and acks the wallpaper once', async () => {
  const { Layout, runBoundedSyncRound, setWallpaper, __instances } = load()

  // The native setter is a disk write plus a WallpaperManager round trip;
  // hold every call open until the test releases them.
  const setterDone = []
  setWallpaper.mockImplementation(() => new Promise((r) => setterDone.push(r)))

  let acked = 0
  const item = { id: 'a', filePath: '/f/a.png' }
  await render(<Layout />)
  const w = __instances[0]
  host(w, (req) => {
    if (req.cmd === 'getState') return memberSnapshot
    if (req.cmd === 'pendingWallpaper') return acked ? null : item
    if (req.cmd === 'markApplied') { acked++; return true }
    return null
  })
  await act(async () => {
    sendFrame(w.IPC, { t: 'evt', event: 'ready', payload: {} })
    await flush()
  })
  // The mount-time getState kicked off the resident apply pass; its setter
  // call is now in flight, so the item is not acked yet.
  expect(setWallpaper).toHaveBeenCalledTimes(1)

  // WorkManager fires with the app alive: the round nudges the resident.
  const round = runBoundedSyncRound()
  round.catch(() => {})
  await flush()
  for (const done of setterDone.splice(0)) done()
  await act(async () => {
    await round
    await flush()
    for (const done of setterDone.splice(0)) done()
    await flush()
  })

  expect(__instances).toHaveLength(1)
  expect(setWallpaper).toHaveBeenCalledTimes(1)
  expect(acked).toBe(1)
})
