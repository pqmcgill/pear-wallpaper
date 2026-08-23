import { render } from '@testing-library/react-native'
import { Waiting } from '../components/Waiting'

test('renders the default waiting copy when there is no joinError', async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: null }} />)
  getByText('Waiting for an existing device to come online and approve this one…')
})

test('a prefix-matched coded joinError renders its specific friendly copy', async () => {
  // blind-pairing-core formats Error#message as `${code}: ${msg}`, not the
  // bare code — this is the exact real-world shape (confirmed on-device,
  // docs/notes/qa-android.md Act 2), so the lookup must match by prefix.
  const { getByText } = await render(
    <Waiting snapshot={{ joinError: 'PAIRING_REJECTED: Pairing was rejected' }} />
  )
  getByText('The creator denied this device.')
})

test('INVITE_USED renders its specific friendly copy', async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: 'INVITE_USED: Invite has been used' }} />)
  getByText('That invite was already used. Ask for a fresh one.')
})

test('INVITE_EXPIRED renders its specific friendly copy', async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: 'INVITE_EXPIRED: Invite has expireds' }} />)
  getByText('That invite expired. Ask for a fresh one.')
})

test("the plain (uncoded) 'superseded by a newer invite' message renders its specific copy", async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: 'superseded by a newer invite' }} />)
  getByText('That join attempt was replaced by a newer one.')
})

test("the plain (uncoded) 'closed' message renders its specific copy", async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: 'closed' }} />)
  getByText('The connection closed before joining finished.')
})

test('an unrecognized joinError falls back to generic copy, and retry guidance always shows', async () => {
  const { getByText } = await render(<Waiting snapshot={{ joinError: 'some weird error' }} />)
  getByText('Could not join. Ask for a fresh invite.')
  getByText('Ask the creator for a fresh invite, then restart the app and paste it to try again.')
})
