import { render, fireEvent } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

let mockSearchParams = {}
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockSearchParams }))
jest.mock('../app/_layout', () => {
  const { createContext } = require('react')
  return { SnapshotContext: createContext(null) }
})
jest.mock('../modules/wallpaper-setter', () => ({ setWallpaper: jest.fn() }))
jest.mock('../lib/settings', () => ({ getTarget: () => 'home', getSettings: () => ({}), setSettings: () => ({}) }))

const { Sent } = require('../components/Sent')
const { MainView } = require('../components/MainView')
const { SnapshotContext } = require('../app/_layout')
const Index = require('../app/index').default

const metrics = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }
const withSafeArea = (ui) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>

const roster = [
  { key: 'self-key', name: 'this-phone', isSelf: true, isCreator: true, online: true },
  { key: 'grandma-key', name: "Grandma's tablet", isSelf: false, online: false },
  { key: 'mac-key', name: 'Living room Mac', isSelf: false, online: true }
]

const sends = [
  {
    id: 's2',
    sentAt: Date.UTC(2026, 8, 25, 18, 0),
    meta: { ext: '.jpg' },
    targets: [{ key: 'grandma-key', status: 'pending' }, { key: 'mac-key', status: 'delivered' }]
  },
  {
    id: 's1',
    sentAt: Date.UTC(2026, 8, 24, 18, 0),
    meta: { ext: '.jpg' },
    targets: [{ key: 'grandma-key', status: 'superseded' }, { key: 'gone-key', status: 'pending' }]
  }
]

test('each send lists every target by name with its delivery status', async () => {
  const { getAllByText, getByText } = await render(<Sent snapshot={{ roster, sends }} />)

  expect(getAllByText("Grandma's tablet")).toHaveLength(2)
  getByText('Living room Mac')
  getByText('Delivered')
  getByText('Replaced by a newer picture')
  expect(getAllByText('Not delivered yet')).toHaveLength(2)
})

test('a target no longer in the roster still shows, as a removed device', async () => {
  const { getByText } = await render(<Sent snapshot={{ roster, sends }} />)
  getByText('A removed device')
})

test('no sends yet shows a short explanation', async () => {
  const { getByText } = await render(<Sent snapshot={{ roster, sends: [] }} />)
  getByText('Pictures you send will show up here.')
})

test('MainView has a Sent tab that shows delivery status', async () => {
  const bridge = { call: jest.fn(() => Promise.resolve()), on: jest.fn() }
  const { getByText, findByText } = await render(withSafeArea(<MainView bridge={bridge} snapshot={{ roster, sends, received: [] }} />))

  await fireEvent.press(getByText('Sent'))

  await findByText('Delivered')
})

test('MainView opens on the tab it is asked for', async () => {
  const bridge = { call: jest.fn(() => Promise.resolve()), on: jest.fn() }
  const { findByText } = await render(withSafeArea(<MainView bridge={bridge} snapshot={{ roster, sends, received: [] }} initialTab="sent" />))

  await findByText('Delivered')
})

test('returning from a send (the tab=sent route param) opens Main on the Sent tab', async () => {
  mockSearchParams = { tab: 'sent' }
  const bridge = { call: jest.fn(() => Promise.resolve()), on: jest.fn() }
  const snapshot = { groupStatus: 'member', roster, sends, received: [], lastError: null }
  const { findByText } = await render(withSafeArea(
    <SnapshotContext.Provider value={{ snapshot, dispatch: jest.fn(), bridge }}>
      <Index />
    </SnapshotContext.Provider>
  ))

  await findByText('Delivered')
})
