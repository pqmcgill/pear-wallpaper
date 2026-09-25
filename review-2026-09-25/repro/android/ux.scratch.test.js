import { render, fireEvent } from '@testing-library/react-native'
const A = '/Users/patrick/code/pear-wallpaper/android'
jest.mock('/Users/patrick/code/pear-wallpaper/android/app/_layout', () => ({ SnapshotContext: require('react').createContext(null) }))
jest.mock('/Users/patrick/code/pear-wallpaper/android/lib/share-target', () => ({ deleteStagedFile: jest.fn() }))
const { SendScreen } = require(A + '/app/send')
const { Received } = require(A + '/components/Received')
const { createApplyController } = require(A + '/lib/apply-controller')

const dump = (s) => JSON.stringify(s.toJSON(), (k, v) => (k === 'props' ? undefined : v))

test('share-sheet Send screen for a device that is not in a group', async () => {
  const bridge = { call: jest.fn(async () => ({})) }
  const s = await render(<SendScreen bridge={bridge} snapshot={{ groupStatus: 'none', roster: [] }} filePath="/data/x/staged.jpg" />)
  console.log('non-member Send screen tree:', dump(s))
  await fireEvent.press(s.getByText('Send'))
  console.log('bridge calls after tapping Send:', bridge.call.mock.calls.length)
  console.log('any Cancel/Back affordance:', !!s.queryByText(/cancel|back/i))
})

test('Received row label for an image sent from another Android phone', async () => {
  const snapshot = { received: [{ id: 'abc', filePath: '/f/abc.png', meta: { ext: '.png', filename: '/data/user/0/com.pearwallpaper.app/files/pear-wallpaper-staging/1787510958028-k3j9x0.png' } }] }
  const s = await render(<Received snapshot={snapshot} setter={jest.fn()} getTarget={() => 'home'} />)
  console.log('Received row:', dump(s))
})

test('a setter failure in the apply controller reaches nobody', async () => {
  const calls = []
  const bridge = { call: jest.fn(async (cmd) => { calls.push(cmd); return cmd === 'pendingWallpaper' ? { id: 'w1', filePath: '/f/w1.png' } : null }) }
  const setter = async () => { throw new Error('WallpaperManager.setStream returned 0') }
  const result = await createApplyController({ bridge, setter }).applyPending()
  console.log('applyPending resolved with:', result, '| bridge calls:', calls, '| createApplyController options accept an error sink?', createApplyController.length)
})
