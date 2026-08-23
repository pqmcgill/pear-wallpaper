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
