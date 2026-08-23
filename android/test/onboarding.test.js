import { render, fireEvent } from '@testing-library/react-native'
import { Onboarding } from '../components/Onboarding'

function fakeBridge (overrides = {}) {
  return { call: jest.fn(() => Promise.resolve()), ...overrides }
}

test('pressing "Create a group" calls bridge.call("createGroup")', async () => {
  const bridge = fakeBridge()
  const { getByText } = await render(<Onboarding bridge={bridge} />)

  await fireEvent.press(getByText('Create a group'))

  expect(bridge.call).toHaveBeenCalledWith('createGroup')
})

test('typing an invite and pressing "Join a group" calls bridge.call("joinGroup", invite)', async () => {
  const bridge = fakeBridge()
  const { getByText, getByPlaceholderText } = await render(<Onboarding bridge={bridge} />)

  await fireEvent.changeText(getByPlaceholderText('Paste invite'), '  some-invite-code  ')
  await fireEvent.press(getByText('Join a group'))

  expect(bridge.call).toHaveBeenCalledWith('joinGroup', 'some-invite-code')
})

test('a rejected join dispatches join-error (never error) and still shows its own friendly inline copy', async () => {
  const bridge = fakeBridge({
    call: jest.fn((cmd) => (
      cmd === 'joinGroup'
        ? Promise.reject(new Error('PAIRING_REJECTED: Pairing was rejected'))
        : Promise.resolve()
    ))
  })
  const dispatch = jest.fn()
  const { getByText, getByPlaceholderText, findByText } = await render(
    <Onboarding bridge={bridge} dispatch={dispatch} />
  )

  await fireEvent.changeText(getByPlaceholderText('Paste invite'), 'some-invite-code')
  await fireEvent.press(getByText('Join a group'))

  // Onboarding's own inline copy (local joinError state) still renders —
  // this must keep working regardless of what's dispatched to the store.
  await findByText('The creator denied this device.')

  // Dispatched into the store as 'join-error', which sets snapshot.joinError
  // only — NOT 'error', which would also set lastError and pop a redundant,
  // unfriendly ErrorBanner on top of the inline copy asserted above
  // (the regression caught in review).
  expect(dispatch).toHaveBeenCalledWith({
    type: 'join-error',
    payload: { message: 'PAIRING_REJECTED: Pairing was rejected' }
  })
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
})
