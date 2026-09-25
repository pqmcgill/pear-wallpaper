import { useReducer } from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'

jest.mock('/Users/patrick/code/pear-wallpaper/android/app/_layout', () => {
  const { createContext } = require('react')
  return { SnapshotContext: createContext(null) }
})
jest.mock('/Users/patrick/code/pear-wallpaper/android/lib/settings', () => ({ getTarget: () => 'home', getSettings: () => ({}), setSettings: () => ({}) }))
jest.mock('/Users/patrick/code/pear-wallpaper/android/modules/wallpaper-setter', () => ({ setWallpaper: jest.fn() }))
jest.mock('/Users/patrick/code/pear-wallpaper/android/components/ScanInvite', () => ({ ScanInvite: () => null }))

const { SnapshotContext } = require('/Users/patrick/code/pear-wallpaper/android/app/_layout')
const Index = require('/Users/patrick/code/pear-wallpaper/android/app/index').default
const { reduce, initialSnapshot } = require('/Users/patrick/code/pear-wallpaper/android/lib/store')

test('a typo in the first pasted invite makes the second, valid join show a failure on Waiting', async () => {
  let pushState
  const bridge = {
    call: jest.fn((cmd, invite) => {
      if (cmd !== 'joinGroup') return Promise.resolve()
      if (invite === 'typo') return Promise.reject(new Error('Invalid invite'))
      // valid invite: core opens the candidate socket and pushes a 'joining'
      // state long before joinGroup settles (creator has not approved yet)
      pushState({ groupStatus: 'joining' })
      return new Promise(() => {})
    }),
    on: jest.fn()
  }
  function Harness () {
    const [snapshot, dispatch] = useReducer(reduce, initialSnapshot)
    pushState = (payload) => dispatch({ type: 'state', payload })
    return (
      <SnapshotContext.Provider value={{ snapshot, dispatch, bridge }}>
        <Index />
      </SnapshotContext.Provider>
    )
  }
  const screen = await render(<Harness />)

  await fireEvent.changeText(screen.getByPlaceholderText('Paste invite'), 'typo')
  await fireEvent.press(screen.getByText('Join a group'))
  await screen.findByText('Could not join. Ask for a fresh invite.')

  await fireEvent.changeText(screen.getByPlaceholderText('Paste invite'), 'good-invite')
  fireEvent.press(screen.getByText('Join a group'))
  await screen.findByText(/restart the app/)

  console.log('Waiting screen text after the valid join started:\n' +
    JSON.stringify(screen.toJSON(), (k, v) => (k === 'props' ? undefined : v)))
  // A pending join should show the neutral waiting copy.
  expect(screen.queryByText('Waiting for an existing device to come online and approve this one…')).not.toBeNull()
})
