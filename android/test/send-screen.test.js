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
// itself, so the real join/copy/extension/reap/delete logic is genuinely
// exercised. `File`/`Directory` constructors accept a mix of strings and
// other File/Directory instances (real expo-file-system contract,
// FileSystem.d.ts) and join them into a single `.uri`.
//
// Files live in a module-level Map keyed by parent-directory uri (not on
// the File/Directory instances themselves) because stageSharedImage() and
// deleteStagedFile() each construct their own fresh File/Directory wrapper
// around the same path — same as the real filesystem underneath separate JS
// wrapper objects. `list()`/`delete()` mirror the real contract
// (FileSystem.d.ts / ExpoFileSystem.types.d.ts): delete() throws if the
// path isn't there, same as the real File.delete() on a file that doesn't
// exist — this is what test 3 below (a throwing delete) exercises for
// real, not via a synthetic mock override. __listStaged/__reset are how the
// test observes and clears it (settings.test.js's __readRaw/__reset idiom).
jest.mock('expo-file-system', () => {
  const DOCUMENT_URI = 'file:///data/user/0/com.pearwallpaper.app/files/'
  const STAGING_DIR_URI = DOCUMENT_URI.replace(/\/$/, '') + '/pear-wallpaper-staging'

  function toUriString (part) {
    return typeof part === 'string' ? part : part.uri
  }
  function joinUri (parts) {
    return parts.map(toUriString).reduce((acc, part) => {
      if (!acc) return part
      return acc.replace(/\/$/, '') + '/' + part.replace(/^\//, '')
    }, '')
  }
  function dirOf (uri) {
    return uri.replace(/\/[^/]*$/, '')
  }

  let createdDirs = new Set()
  let filesByDir = new Map()

  class FakeDirectory {
    constructor (...parts) {
      this._uri = joinUri(parts)
    }

    get uri () { return this._uri }
    get exists () { return createdDirs.has(this._uri) }
    create () { createdDirs.add(this._uri) }
    list () {
      return (filesByDir.get(this._uri) || []).map((uri) => new FakeFile(uri))
    }
  }
  class FakeFile {
    constructor (...parts) {
      this._uri = joinUri(parts)
    }

    get uri () { return this._uri }
    copy (destination) {
      destination.copiedFrom = this._uri
      const dir = dirOf(destination.uri)
      filesByDir.set(dir, [...(filesByDir.get(dir) || []), destination.uri])
    }

    delete () {
      const dir = dirOf(this._uri)
      const list = filesByDir.get(dir) || []
      if (!list.includes(this._uri)) {
        throw new Error(`FakeFile.delete: no such file ${this._uri}`)
      }
      filesByDir.set(dir, list.filter((uri) => uri !== this._uri))
    }
  }
  return {
    Paths: { document: { uri: DOCUMENT_URI } },
    File: FakeFile,
    Directory: FakeDirectory,
    __listStaged: () => [...(filesByDir.get(STAGING_DIR_URI) || [])],
    __reset: () => { createdDirs = new Set(); filesByDir = new Map() }
  }
})

const { stageSharedImage } = require('../lib/share-target')
const { __listStaged, __reset } = require('expo-file-system')

// send.js's post-send cleanup is deliberately log-and-continue (a cleanup
// failure must never surface as a send failure) — several tests below use a
// filePath that was never staged, so that path's console.warn is expected
// noise, not a real problem. Suppressed globally here so `npm run test:ui`
// stays pristine; the one test that cares asserts on this spy directly.
let warnSpy
beforeEach(() => {
  __reset()
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { warnSpy.mockRestore() })

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

test('a device not in a group sees why it cannot send, and can cancel back out', async () => {
  const onCancel = jest.fn()
  const { getByText } = await render(
    <SendScreen bridge={fakeBridge()} snapshot={{ groupStatus: 'none', roster: [] }} filePath="/staged/photo.png" onCancel={onCancel} />
  )

  getByText('Join a group first, then share the picture again.')
  await fireEvent.press(getByText('Cancel'))
  expect(onCancel).toHaveBeenCalled()
})

test('the only device in a group is told to add another one', async () => {
  const { getByText } = await render(
    <SendScreen
      bridge={fakeBridge()}
      snapshot={{ groupStatus: 'member', roster: [{ key: 'self-key', name: 'this-phone', isSelf: true }] }}
      filePath="/staged/photo.png"
    />
  )

  getByText('No other devices in your group yet. Invite one from Devices, then share the picture again.')
})

test('a device with targets sees no empty-state copy', async () => {
  const { queryByText } = await render(
    <SendScreen bridge={fakeBridge()} snapshot={{ groupStatus: 'member', ...snapshot }} filePath="/staged/photo.png" />
  )

  expect(queryByText(/share the picture again/)).toBeNull()
})

describe('stageSharedImage', () => {
  test('copies the shared uri into a timestamped file under the staging dir, preserving its extension', () => {
    const staged = stageSharedImage('content://com.android.providers.media/document/photo.png')

    expect(staged).toMatch(/\/pear-wallpaper-staging\/\d+-[0-9a-z]{6}\.png$/)
    expect(staged).not.toMatch(/^file:/) // plain path, no leftover scheme — worklet fs wants this
  })

  test('falls back to a default extension when the uri has none (e.g. an opaque content:// id)', () => {
    const staged = stageSharedImage('content://media/external/images/media/12345')

    expect(staged).toMatch(/\/pear-wallpaper-staging\/\d+-[0-9a-z]{6}\.jpg$/)
  })

  test('the staged filename carries a random suffix guarding against same-millisecond collisions', () => {
    const staged = stageSharedImage('content://com.android.providers.media/document/photo.png')

    expect(staged).toMatch(/\/pear-wallpaper-staging\/\d+-[0-9a-z]{6}\.png$/)
  })

  test('staging a second image removes the first staged file', () => {
    const first = stageSharedImage('content://.../a.png')
    expect(__listStaged()).toEqual(['file://' + first])

    const second = stageSharedImage('content://.../b.png')

    expect(__listStaged()).toEqual(['file://' + second])
  })
})

describe('post-send staging cleanup', () => {
  test('cancelling deletes the staged file without sending', async () => {
    const staged = stageSharedImage('content://.../photo.png')
    const bridge = fakeBridge()
    const { getByText } = await render(
      <SendScreen bridge={bridge} snapshot={snapshot} filePath={staged} onCancel={jest.fn()} />
    )

    await fireEvent.press(getByText('Cancel'))

    expect(__listStaged()).toEqual([])
    expect(bridge.call).not.toHaveBeenCalled()
  })

  test('a successful send deletes the staged file it just sent', async () => {
    const staged = stageSharedImage('content://.../photo.png')
    expect(__listStaged()).toHaveLength(1)

    const bridge = fakeBridge()
    const { getByText, getAllByRole } = await render(
      <SendScreen bridge={bridge} snapshot={snapshot} filePath={staged} />
    )
    await fireEvent(getAllByRole('switch')[0], 'valueChange', true)
    await fireEvent.press(getByText('Send'))

    expect(__listStaged()).toEqual([])
  })

  test('a throwing cleanup delete does not reject the send flow', async () => {
    const bridge = fakeBridge()
    const onSent = jest.fn()
    // filePath was never staged via stageSharedImage, so deleteStagedFile's
    // underlying File.delete() throws (no such file) -- same real-world
    // shape as a cleanup racing an already-reaped staging dir. This
    // exercises the log-and-continue guard in send.js for real, not via a
    // synthetic mock override.
    const { getByText, getAllByRole } = await render(
      <SendScreen bridge={bridge} snapshot={snapshot} filePath="/never/staged.png" onSent={onSent} />
    )
    await fireEvent(getAllByRole('switch')[0], 'valueChange', true)
    await fireEvent.press(getByText('Send'))

    expect(onSent).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})
