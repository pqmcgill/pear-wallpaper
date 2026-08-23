import { render, fireEvent } from '@testing-library/react-native'
import { Received } from '../components/Received'

const snapshot = {
  received: [
    { id: 'r1', filePath: '/f/one.jpg', meta: { filename: 'one.jpg' } },
    { id: 'r2', filePath: '/f/two.jpg', meta: { filename: 'two.jpg' } }
  ]
}

test('renders every item from snapshot.received', async () => {
  const { getByText } = await render(
    <Received snapshot={snapshot} setter={jest.fn()} getTarget={() => 'home'} />
  )

  getByText('one.jpg')
  getByText('two.jpg')
})

test('Reapply calls the setter directly with item.filePath and the current target — no bridge/markApplied involved', async () => {
  const setter = jest.fn(() => Promise.resolve())
  const getTarget = jest.fn(() => 'both')
  const { getAllByText } = await render(
    <Received snapshot={snapshot} setter={setter} getTarget={getTarget} />
  )

  await fireEvent.press(getAllByText('Re-apply')[0])

  expect(setter).toHaveBeenCalledWith('/f/one.jpg', 'both')
  // Received has no bridge at all — reapply is structurally incapable of
  // calling bridge.call('markApplied', ...) the way desktop's `reapply`
  // command (and Task 6's apply-controller) does; this is the point of
  // Android calling the native setter directly for a manual reapply.
})

test('a setter failure surfaces inline without throwing', async () => {
  const setter = jest.fn(() => Promise.reject(new Error('decode failed')))
  const { getAllByText, findByText } = await render(
    <Received snapshot={snapshot} setter={setter} getTarget={() => 'home'} />
  )

  await fireEvent.press(getAllByText('Re-apply')[0])

  await findByText('decode failed')
})
