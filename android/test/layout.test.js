import { render, act } from '@testing-library/react-native'

// app/_layout.js's share-intent effect (Task 8) is the focus here: does a
// throwing stageSharedImage() degrade to the error banner instead of
// crashing the app or navigating to /send with nothing staged? Every other
// dependency _layout.js pulls in (worklet-client, background-sync,
// expo-task-manager, expo-background-task) is mocked wholesale — none of
// that machinery is what this test exercises (worklet-lifecycle.test.js
// mounts Layout against the real worklet-client).
const mockRouterReplace = jest.fn()
jest.mock('expo-router', () => {
  const { useContext: useCtx } = require('react')
  const { Text: RNText } = require('react-native')
  return {
    useRouter: () => ({ replace: mockRouterReplace }),
    // Standing in for expo-router's real <Slot />: a consumer of the same
    // SnapshotContext _layout.js exports, rendering lastError the same way
    // app/index.js's ErrorBanner does. This is the only way to observe
    // _layout.js's internal dispatch()/useReducer state from outside.
    Slot: function MockSlot () {
      const { SnapshotContext } = require('../app/_layout')
      const { snapshot } = useCtx(SnapshotContext)
      if (!snapshot.lastError) return null
      return <RNText>{snapshot.lastError}</RNText>
    }
  }
})

let mockShareIntentState
const mockResetShareIntent = jest.fn()
jest.mock('expo-share-intent', () => ({
  useShareIntent: () => mockShareIntentState
}))

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }))
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  BackgroundTaskResult: { Success: 1, Failed: 2 }
}))
jest.mock('../lib/background-sync', () => ({ runBoundedSyncRound: jest.fn() }))

const mockBridge = { call: jest.fn(() => Promise.resolve({})), on: jest.fn(), applyPending: jest.fn() }
jest.mock('../lib/worklet-client', () => ({
  getBridge: jest.fn(() => mockBridge),
  getWorklet: jest.fn(() => null)
}))

const mockStageSharedImage = jest.fn()
jest.mock('../lib/share-target', () => ({
  stageSharedImage: (...args) => mockStageSharedImage(...args)
}))

import Layout from '../app/_layout'

let warnSpy
beforeEach(() => {
  jest.clearAllMocks()
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  mockShareIntentState = {
    hasShareIntent: true,
    shareIntent: { files: [{ path: 'content://com.android.providers.media/document/photo.png' }] },
    resetShareIntent: mockResetShareIntent
  }
})
afterEach(() => { warnSpy.mockRestore() })

test('a throwing stageSharedImage degrades to an error banner, does not navigate, and does not throw out of the effect', async () => {
  mockStageSharedImage.mockImplementation(() => {
    throw new Error('Permission Denial: revoked content:// grant')
  })

  const { findByText } = await render(<Layout />)

  await findByText(/Permission Denial: revoked content:\/\/ grant/)
  expect(mockRouterReplace).not.toHaveBeenCalled()
  expect(warnSpy).toHaveBeenCalled()
})

test('a successful stageSharedImage still navigates to /send with the staged path', async () => {
  mockStageSharedImage.mockReturnValue('/staged/photo.png')

  await render(<Layout />)

  expect(mockRouterReplace).toHaveBeenCalledWith({
    pathname: '/send',
    params: { filePath: '/staged/photo.png' }
  })
})

// #2: the staged copy has a generated name, so the share's own display
// name rides along for the receiver to see.
test('the shared file\'s display name travels to /send with the staged path', async () => {
  mockShareIntentState.shareIntent.files[0].fileName = 'beach.png'
  mockStageSharedImage.mockReturnValue('/staged/1787510958028-k3j9x0.png')

  await render(<Layout />)

  expect(mockRouterReplace).toHaveBeenCalledWith({
    pathname: '/send',
    params: { filePath: '/staged/1787510958028-k3j9x0.png', filename: 'beach.png' }
  })
})

test("a bridge 'error' event (how worklet-client reports a failed wallpaper apply) reaches the error banner", async () => {
  mockShareIntentState = { hasShareIntent: false, shareIntent: {}, resetShareIntent: mockResetShareIntent }

  const { findByText } = await render(<Layout />)
  const [, onError] = mockBridge.on.mock.calls.find(([event]) => event === 'error')
  await act(async () => onError({ message: "Couldn't set the new wallpaper: WallpaperManager.setStream returned 0" }))

  await findByText(/Couldn't set the new wallpaper/)
})
