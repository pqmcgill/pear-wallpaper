import { reduce, initialSnapshot } from '../lib/store'

test('state events fold into the snapshot', () => {
  const s = reduce(initialSnapshot, { type: 'state', payload: { groupStatus: 'member', roster: [{ name: 'mac' }] } })
  expect(s.groupStatus).toBe('member')
  expect(s.roster).toHaveLength(1)
})

test('error while joining also routes to joinError (resumed-join failure case)', () => {
  const joining = reduce(initialSnapshot, { type: 'state', payload: { groupStatus: 'joining' } })
  const s = reduce(joining, { type: 'error', payload: { message: 'boom' } })
  expect(s.lastError).toBe('boom')
  expect(s.joinError).toBe('boom')
})

test('error while not joining sets lastError only', () => {
  const s = reduce(initialSnapshot, { type: 'error', payload: { message: 'boom' } })
  expect(s.lastError).toBe('boom')
  expect(s.joinError).toBeNull()
})

test('dismiss-error clears lastError but leaves the rest of the snapshot alone', () => {
  const withError = reduce(initialSnapshot, { type: 'error', payload: { message: 'boom' } })
  const s = reduce(withError, { type: 'dismiss-error' })
  expect(s.lastError).toBeNull()
})

test('join-error sets joinError only — lastError is untouched (no ErrorBanner regression)', () => {
  const s = reduce(initialSnapshot, { type: 'join-error', payload: { message: 'PAIRING_REJECTED: Pairing was rejected' } })
  expect(s.joinError).toBe('PAIRING_REJECTED: Pairing was rejected')
  expect(s.lastError).toBeNull()
})
