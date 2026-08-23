import { render, fireEvent } from '@testing-library/react-native'

// In-memory stand-in for the one settings.json file lib/settings.js reads
// and writes, exercising the real getSettings()/setSettings() logic (not a
// mock of lib/settings.js itself) so the toggle's round-trip through the
// file is genuinely covered. State lives inside the factory closure (jest's
// babel-plugin-jest-hoist forbids referencing out-of-scope variables from a
// jest.mock() factory); __readRaw/__reset below are how the test observes
// and clears it.
jest.mock('expo-file-system', () => {
  let contents = null
  class FakeFile {
    get exists () { return contents !== null }
    textSync () { return contents }
    write (content) { contents = content }
    create () { if (contents === null) contents = '' }
  }
  return {
    Paths: { document: {} },
    File: FakeFile,
    __readRaw: () => contents,
    __reset: () => { contents = null }
  }
})

const { Settings } = require('../components/Settings')
const { __readRaw, __reset } = require('expo-file-system')

beforeEach(() => { __reset() })

function fakeBridge (overrides = {}) {
  return { call: jest.fn(() => Promise.resolve()), ...overrides }
}

const snapshot = {
  deviceKey: 'abc123',
  deviceName: 'test-phone',
  lastSync: null
}

test('the lock-screen toggle round-trips through the (mocked) settings file', async () => {
  const bridge = fakeBridge()
  const { getByRole } = await render(<Settings bridge={bridge} snapshot={snapshot} />)

  const toggle = getByRole('switch')
  expect(toggle.props.value).toBe(false)

  await fireEvent(toggle, 'valueChange', true)

  // The file itself now reflects the change...
  expect(JSON.parse(__readRaw())).toEqual({ lockScreen: true })

  // ...and a freshly mounted instance reads that persisted value back.
  const { getByRole: getByRoleAgain } = await render(<Settings bridge={bridge} snapshot={snapshot} />)
  expect(getByRoleAgain('switch').props.value).toBe(true)
})

test('no login-at-login control is rendered when the snapshot lacks the loginAtLogin key', async () => {
  const bridge = fakeBridge()
  const { queryByText } = await render(<Settings bridge={bridge} snapshot={snapshot} />)

  expect(queryByText('Launch at login')).toBeNull()
})

test('a loginAtLogin key present in the snapshot renders the toggle, wired to setLoginAtLogin', async () => {
  const bridge = fakeBridge()
  const { getByText, getAllByRole } = await render(
    <Settings bridge={bridge} snapshot={{ ...snapshot, loginAtLogin: false }} />
  )

  getByText('Launch at login')
  const switches = getAllByRole('switch')
  // Lock-screen switch is always first; login-at-login is the second one.
  await fireEvent(switches[1], 'valueChange', true)

  expect(bridge.call).toHaveBeenCalledWith('setLoginAtLogin', true)
})
