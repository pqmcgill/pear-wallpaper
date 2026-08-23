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

import { getBridge } from '../lib/worklet-client'
const { __instances } = require('react-native-bare-kit')

test('first frame is init with storageDir + deviceName; singleton thereafter', () => {
  const bridge = getBridge()
  const w = __instances[0]
  const first = JSON.parse(w.IPC.written[0])
  expect(first.t).toBe('init')
  expect(first.deviceName).toBe('Pixel Test')
  expect(first.storageDir).toMatch(/pear-wallpaper/)
  expect(getBridge()).toBe(bridge) // single-writer rule, enforcement point 1
  expect(__instances).toHaveLength(1)
})

test('storageDir has no leftover file:// scheme from the Paths.document URI', () => {
  const w = __instances[0]
  const first = JSON.parse(w.IPC.written[0])
  expect(first.storageDir).not.toMatch(/file:/)
  expect(first.storageDir).toBe('/data/user/0/com.pearwallpaper.app/files/pear-wallpaper')
})

test('a terminal error (arriving before ready, i.e. a failed init) clears the singleton so the next getBridge() starts a fresh worklet', () => {
  const bridge = getBridge()
  const w = __instances[__instances.length - 1]
  // Simulate the host's init-failure frame (worklet/host.js) arriving over
  // the wire before any 'ready' evt for this instance.
  w.IPC.emit('data', Buffer.from(JSON.stringify({ t: 'evt', event: 'error', payload: { message: 'boom' } }) + '\n'))

  const nextBridge = getBridge()
  expect(nextBridge).not.toBe(bridge)
  expect(__instances).toHaveLength(2)
})

test('an error arriving after ready is a normal operational error, not terminal — singleton survives', () => {
  const bridge = getBridge()
  const w = __instances[__instances.length - 1]
  w.IPC.emit('data', Buffer.from(JSON.stringify({ t: 'evt', event: 'ready', payload: {} }) + '\n'))
  w.IPC.emit('data', Buffer.from(JSON.stringify({ t: 'evt', event: 'error', payload: { message: 'auto-resume join failed' } }) + '\n'))

  expect(getBridge()).toBe(bridge)
  expect(__instances).toHaveLength(2)
})
