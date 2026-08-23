import { render, fireEvent } from '@testing-library/react-native'
import { ScanInvite } from '../components/ScanInvite'

// The mock's factory can only reference out-of-scope identifiers that start
// with "mock" (jest's babel-plugin-jest-hoist rule) — hence the naming here.
let mockCameraProps = null
const mockUseCameraPermissions = jest.fn()

jest.mock('expo-camera', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    // Stand-in for the native CameraView: a plain View that records
    // whatever props ScanInvite passed it, so the test can drive
    // onBarcodeScanned directly (mirrors the real scanner's repeated fires).
    CameraView: (props) => {
      mockCameraProps = props
      return React.createElement(View, { testID: 'camera-view' })
    },
    useCameraPermissions: (...args) => mockUseCameraPermissions(...args)
  }
})

beforeEach(() => {
  mockCameraProps = null
  mockUseCameraPermissions.mockReset()
})

test('the first onBarcodeScanned call reports the invite; later calls are latched out', async () => {
  mockUseCameraPermissions.mockReturnValue([
    { granted: true, canAskAgain: true, status: 'granted', expires: 'never' },
    jest.fn()
  ])
  const onScanned = jest.fn()
  await render(<ScanInvite onScanned={onScanned} onCancel={jest.fn()} />)

  expect(mockCameraProps).not.toBeNull()
  mockCameraProps.onBarcodeScanned({ data: 'pear://invite-string' })
  mockCameraProps.onBarcodeScanned({ data: 'pear://invite-string' })
  mockCameraProps.onBarcodeScanned({ data: 'pear://a-different-invite' })

  expect(onScanned).toHaveBeenCalledTimes(1)
  expect(onScanned).toHaveBeenCalledWith('pear://invite-string')
})

test('scanner settings ask for QR only', async () => {
  mockUseCameraPermissions.mockReturnValue([
    { granted: true, canAskAgain: true, status: 'granted', expires: 'never' },
    jest.fn()
  ])
  await render(<ScanInvite onScanned={jest.fn()} onCancel={jest.fn()} />)

  expect(mockCameraProps.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] })
})

test('permission denied renders a fallback message and a cancel control; paste remains the path', async () => {
  const requestPermission = jest.fn().mockResolvedValue({
    granted: false, canAskAgain: false, status: 'denied', expires: 'never'
  })
  mockUseCameraPermissions.mockReturnValue([
    { granted: false, canAskAgain: false, status: 'denied', expires: 'never' },
    requestPermission
  ])
  const onCancel = jest.fn()
  const { getByText, queryByTestId } = await render(<ScanInvite onScanned={jest.fn()} onCancel={onCancel} />)

  expect(queryByTestId('camera-view')).toBeNull()
  expect(getByText(/camera/i)).toBeTruthy()

  await fireEvent.press(getByText('Cancel'))
  expect(onCancel).toHaveBeenCalledTimes(1)
})
