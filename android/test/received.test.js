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

  getByText(/one\.jpg/)
  getByText(/two\.jpg/)
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

// #2: a row says who sent it and when, and never shows a path, including
// the full paths old groups replicated before core basenamed them.
test('rows show the sender\'s roster name, and only a basename of an old full path', async () => {
  const appliedAt = Date.UTC(2026, 8, 25, 18, 30)
  const withSenders = {
    roster: [{ key: 'bb', name: 'Mom\'s phone' }],
    received: [
      { id: 'r1', fromKey: 'bb', filePath: '/f/one.png', appliedAt, meta: { filename: '/data/user/0/com.pearwallpaper.app/files/pear-wallpaper-staging/beach.png' } },
      { id: 'r2', fromKey: 'gone', filePath: '/f/two.png', appliedAt, meta: { filename: null } }
    ]
  }
  const { getByText, getAllByText, queryByText, toJSON } = await render(
    <Received snapshot={withSenders} setter={jest.fn()} getTarget={() => 'home'} />
  )

  getByText('From Mom\'s phone')
  getByText('From a removed device')
  getByText(/beach\.png/)
  expect(getAllByText(/2026/)).toHaveLength(2)
  expect(JSON.stringify(toJSON())).not.toMatch(/pear-wallpaper-staging|com\.pearwallpaper/)
  expect(queryByText('r2')).toBeNull()
})
