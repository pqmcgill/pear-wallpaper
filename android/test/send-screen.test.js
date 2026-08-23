import { render, fireEvent } from '@testing-library/react-native'

// SendScreen is imported from app/send.js, which (like every screen reached
// through app/index.js) pulls in ./_layout -> lib/worklet-client for the
// SnapshotContext export — same minimal native-module mock smoke.test.js
// uses, needed here purely so the import chain resolves under jest.
jest.mock('react-native-bare-kit', () => {
  const fakeIPC = { on: jest.fn(), write: jest.fn() }
  class Worklet {
    constructor () { this.IPC = fakeIPC }
    start () {}
  }
  return { Worklet }
})
jest.mock('expo-device', () => ({ modelName: 'Pixel Test' }))
jest.mock('../app/gen/worklet.bundle.mjs', () => ({ __esModule: true, default: 'fake-bundle-source' }), { virtual: true })

import { SendScreen } from '../app/send'

// Fake expo-file-system for stageSharedImage()'s tests below. Mirrors the
// idiom already used in test/settings.test.js/worklet-client.test.js: a
// minimal in-memory File/Directory pair, not a mock of lib/share-target.js
// itself, so the real join/copy/extension logic is genuinely exercised.
// `File`/`Directory` constructors accept a mix of strings and other
// File/Directory instances (real expo-file-system contract, FileSystem.d.ts)
// and join them into a single `.uri`.
jest.mock('expo-file-system', () => {
  function toUriString (part) {
    return typeof part === 'string' ? part : part.uri
  }
  function joinUri (parts) {
    return parts.map(toUriString).reduce((acc, part) => {
      if (!acc) return part
      return acc.replace(/\/$/, '') + '/' + part.replace(/^\//, '')
    }, '')
  }
  class FakeDirectory {
    constructor (...parts) {
      this._uri = joinUri(parts)
      this.exists = false
    }

    get uri () { return this._uri }
    create () { this.exists = true }
  }
  class FakeFile {
    constructor (...parts) {
      this._uri = joinUri(parts)
    }

    get uri () { return this._uri }
    copy (destination) { destination.copiedFrom = this._uri }
  }
  return {
    Paths: { document: { uri: 'file:///data/user/0/com.pearwallpaper.app/files/' } },
    File: FakeFile,
    Directory: FakeDirectory
  }
})

const { stageSharedImage } = require('../lib/share-target')

function fakeBridge (overrides = {}) {
  return { call: jest.fn(() => Promise.resolve()), ...overrides }
}

const snapshot = {
  roster: [
    { key: 'self-key', name: 'this-phone', isSelf: true },
    { key: 'device-a', name: 'Device A', isSelf: false },
    { key: 'device-b', name: 'Device B', isSelf: false }
  ]
}

test('Send is disabled with zero targets selected', async () => {
  const bridge = fakeBridge()
  const { getByText } = await render(
    <SendScreen bridge={bridge} snapshot={snapshot} filePath="/staged/photo.png" />
  )

  await fireEvent.press(getByText('Send'))

  expect(bridge.call).not.toHaveBeenCalled()
})

test('toggling one target and pressing Send calls sendWallpaper with only that key', async () => {
  const bridge = fakeBridge()
  const { getByText, getAllByRole } = await render(
    <SendScreen bridge={bridge} snapshot={snapshot} filePath="/staged/photo.png" />
  )

  // Roster rows render self-filtered, in roster order: Device A, Device B.
  const switches = getAllByRole('switch')
  await fireEvent(switches[1], 'valueChange', true) // Device B

  await fireEvent.press(getByText('Send'))

  expect(bridge.call).toHaveBeenCalledWith('sendWallpaper', {
    filePath: '/staged/photo.png',
    targets: ['device-b']
  })
})

test('a successful send calls onSent', async () => {
  const bridge = fakeBridge()
  const onSent = jest.fn()
  const { getByText, getAllByRole } = await render(
    <SendScreen bridge={bridge} snapshot={snapshot} filePath="/staged/photo.png" onSent={onSent} />
  )

  await fireEvent(getAllByRole('switch')[0], 'valueChange', true)
  await fireEvent.press(getByText('Send'))

  expect(onSent).toHaveBeenCalled()
})

test('a sendWallpaper rejection surfaces inline without calling onSent', async () => {
  const bridge = fakeBridge({ call: jest.fn(() => Promise.reject(new Error('not in a group'))) })
  const onSent = jest.fn()
  const { getByText, getAllByRole, findByText } = await render(
    <SendScreen bridge={bridge} snapshot={snapshot} filePath="/staged/photo.png" onSent={onSent} />
  )

  await fireEvent(getAllByRole('switch')[0], 'valueChange', true)
  await fireEvent.press(getByText('Send'))

  await findByText('not in a group')
  expect(onSent).not.toHaveBeenCalled()
})

describe('stageSharedImage', () => {
  test('copies the shared uri into a timestamped file under the staging dir, preserving its extension', () => {
    const staged = stageSharedImage('content://com.android.providers.media/document/photo.png')

    expect(staged).toMatch(/\/pear-wallpaper-staging\/\d+\.png$/)
    expect(staged).not.toMatch(/^file:/) // plain path, no leftover scheme — worklet fs wants this
  })

  test('falls back to a default extension when the uri has none (e.g. an opaque content:// id)', () => {
    const staged = stageSharedImage('content://media/external/images/media/12345')

    expect(staged).toMatch(/\/pear-wallpaper-staging\/\d+\.jpg$/)
  })
})
