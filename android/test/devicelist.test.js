import { render, fireEvent } from '@testing-library/react-native'
import { DeviceList } from '../components/DeviceList'

function fakeBridge (overrides = {}) {
  return { call: jest.fn(() => Promise.resolve()), ...overrides }
}

const snapshot = {
  roster: [
    { key: 'self-key', name: 'this-phone', isSelf: true, isCreator: true, online: true },
    { key: 'other-key', name: 'other-device', isSelf: false, isCreator: false, online: true }
  ]
}

test('"New invite" calls createInvite and renders the result as selectable text and an SVG QR', async () => {
  const bridge = fakeBridge({
    call: jest.fn((cmd) => (cmd === 'createInvite' ? Promise.resolve('the-invite-string') : Promise.resolve()))
  })
  const { getByText, findByText, findByTestId } = await render(
    <DeviceList bridge={bridge} snapshot={snapshot} candidates={[]} />
  )

  await fireEvent.press(getByText('New invite'))

  expect(bridge.call).toHaveBeenCalledWith('createInvite')
  await findByText('the-invite-string')
  await findByTestId('invite-qr')
})

test('a pending candidate renders an approval row whose Approve/Deny press calls approve(key)/deny(key)', async () => {
  const bridge = fakeBridge()
  const candidates = [{ candidateKey: 'candidate-key', name: 'new-device' }]
  const { getByText } = await render(
    <DeviceList bridge={bridge} snapshot={snapshot} candidates={candidates} />
  )

  getByText(/new-device/)

  await fireEvent.press(getByText('Approve'))
  expect(bridge.call).toHaveBeenCalledWith('approve', 'candidate-key')

  await fireEvent.press(getByText('Deny'))
  expect(bridge.call).toHaveBeenCalledWith('deny', 'candidate-key')
})

test('a roster row\'s Remove press calls removeDevice(key) for every non-self device', async () => {
  const bridge = fakeBridge()
  const { getByText, queryAllByText } = await render(
    <DeviceList bridge={bridge} snapshot={snapshot} candidates={[]} />
  )

  // Only the non-self roster row gets a Remove control.
  expect(queryAllByText('Remove')).toHaveLength(1)

  await fireEvent.press(getByText('Remove'))
  expect(bridge.call).toHaveBeenCalledWith('removeDevice', 'other-key')
})
