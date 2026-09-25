import { useReducer } from 'react'
import { render, fireEvent } from '@testing-library/react-native'

// Mounts the real app/index.js routing, Onboarding, Waiting and the store
// reducer under a stand-in provider, so a join attempt's effect on shared
// snapshot state is observed the way the user sees it.
jest.mock('../app/_layout', () => {
  const { createContext } = require('react')
  return { SnapshotContext: createContext(null) }
})
jest.mock('../lib/settings', () => ({ getTarget: () => 'home' }))
jest.mock('../modules/wallpaper-setter', () => ({ setWallpaper: jest.fn() }))
jest.mock('../components/ScanInvite', () => ({ ScanInvite: () => null }))

const { SnapshotContext } = require('../app/_layout')
const Index = require('../app/index').default
const { reduce, initialSnapshot } = require('../lib/store')

test('a bad first invite does not make the next, valid join show a failure on Waiting', async () => {
  let pushState
  const bridge = {
    call: jest.fn((cmd, invite) => {
      if (cmd !== 'joinGroup') return Promise.resolve()
      if (invite === 'typo') return Promise.reject(new Error('Invalid invite'))
      // A valid invite: core opens the candidate socket and pushes a
      // 'joining' state long before joinGroup settles (creator not yet
      // approved).
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
  // Not awaited: this joinGroup never settles, as it would not while the
  // creator has yet to approve.
  fireEvent.press(screen.getByText('Join a group'))

  await screen.findByText('Waiting for an existing device to come online and approve this one…')
  expect(screen.queryByText(/restart the app/)).toBeNull()
})
