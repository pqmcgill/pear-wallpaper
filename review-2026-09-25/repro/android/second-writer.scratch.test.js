const A = '/Users/patrick/code/pear-wallpaper/android'
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
    start () {}
    terminate () { this.terminated = true }
  }
  return { Worklet, __instances: instances }
})
jest.mock('expo-device', () => ({ modelName: 'Pixel Test' }))
jest.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///data/user/0/com.pearwallpaper.app/files/' } } }))
jest.mock('/Users/patrick/code/pear-wallpaper/android/app/gen/worklet.bundle.mjs', () => ({ __esModule: true, default: 'bundle' }), { virtual: true })
jest.mock('/Users/patrick/code/pear-wallpaper/android/modules/wallpaper-setter', () => ({ setWallpaper: jest.fn(async () => true) }))
jest.mock('/Users/patrick/code/pear-wallpaper/android/lib/settings', () => ({ getTarget: () => 'home' }))

test('app UI mounting while a headless fresh-worklet round is in flight opens a second Worklet on the same storageDir', async () => {
  const { runBoundedSyncRound } = require(A + '/lib/background-sync')
  const { getBridge, isActive } = require(A + '/lib/worklet-client')
  const { __instances } = require('react-native-bare-kit')

  expect(isActive()).toBe(false)           // app process killed; WorkManager respawned it headless
  const round = runBoundedSyncRound()      // fresh round: its own Worklet, holding the corestore
  round.catch(() => {})
  console.log('isActive() while the headless round runs:', isActive())

  getBridge()                              // user taps the launcher icon: _layout.js mounts, same JS runtime

  const inits = __instances.map((w) => JSON.parse(w.IPC.written[0]))
  console.log('Worklet instances:', __instances.length)
  console.log('init frames:', inits)
  expect(__instances.length).toBe(1)
})
