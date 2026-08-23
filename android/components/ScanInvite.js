import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'

// QR alternative to Onboarding's paste field. Props: { onScanned(inviteString),
// onCancel() }. `scannedRef` latches the first hit: real scanners keep firing
// onBarcodeScanned on every frame that still contains the code, and without
// the latch the same invite would be redeemed (or the same rejection routed)
// more than once.
export function ScanInvite ({ onScanned, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions()
  const scannedRef = useRef(false)

  useEffect(() => {
    if (!permission || !permission.granted) requestPermission()
    // Request once on mount; re-requesting on every `permission` change
    // would loop if the user has permanently denied it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBarcodeScanned = ({ data }) => {
    if (scannedRef.current) return
    scannedRef.current = true
    onScanned(data)
  }

  if (!permission || !permission.granted) {
    return (
      <View style={styles.section}>
        <Text style={styles.message}>
          Camera access is needed to scan a QR invite. You can paste the invite instead.
        </Text>
        <Pressable onPress={onCancel}>
          <Text>Cancel</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.section}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <Pressable onPress={onCancel}>
        <Text>Cancel</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  camera: { width: '100%', height: 320, marginBottom: 16 },
  message: { marginBottom: 16, textAlign: 'center' }
})
