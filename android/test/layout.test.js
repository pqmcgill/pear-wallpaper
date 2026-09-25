import { render, act } from '@testing-library/react-native'

// app/_layout.js's share-intent effect (Task 8) is the focus here: does a
// throwing stageSharedImage() degrade to the error banner instead of
// crashing the app or navigating to /send with nothing staged? Every other
// dependency _layout.js pulls in (worklet-client, apply-controller, the
// native setter, settings, background-sync, expo-task-manager,
// expo-background-task) is mocked wholesale, the same "only the surface
// under test is real" idiom background-sync.test.js uses for
// worklet-client — none of that machinery is what this test exercises.
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

jest.mock('../lib/worklet-client', () => ({
  getBridge: jest.fn(() => ({ call: jest.fn(() => Promise.resolve({})), on: jest.fn() })),
  getWorklet: jest.fn(() => null)
}))
jest.mock('../lib/apply-controller', () => ({
  createApplyController: jest.fn(() => ({ applyPending: jest.fn() }))
}))
jest.mock('../modules/wallpaper-setter', () => ({ setWallpaper: jest.fn() }))
jest.mock('../lib/settings', () => ({ getTarget: jest.fn(() => 'home') }))

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

test('a failed wallpaper apply reaches the error banner', async () => {
  mockShareIntentState = { hasShareIntent: false, shareIntent: {}, resetShareIntent: mockResetShareIntent }
  const { createApplyController } = require('../lib/apply-controller')

  const { findByText } = await render(<Layout />)
  const { onError } = createApplyController.mock.calls[0][0]
  await act(async () => onError(new Error('WallpaperManager.setStream returned 0')))

  await findByText(/Couldn't set the new wallpaper/)
})
