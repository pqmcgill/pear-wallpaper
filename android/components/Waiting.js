import { View, Text, StyleSheet } from 'react-native'

// This map covers the restart-resumed-join path only: the worklet resumes a
// pending join on startup and, if it fails, emits a bare 'error-joining'
// signal (no message detail) via bridge-main.js. The interactive rejection
// UX (with the full joinGroup() rejection taxonomy) lives in Onboarding,
// which awaits bridge.call('joinGroup', ...) directly. Mirrors
// desktop/ui/components/Waiting.js.
const MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.'
}

export function Waiting ({ snapshot }) {
  const err = snapshot.joinError
  if (err) {
    return (
      <View style={styles.section}>
        <Text>{MESSAGES[err] || 'Could not join. Ask for a fresh invite.'}</Text>
      </View>
    )
  }
  return (
    <View style={styles.section}>
      <Text>Waiting for an existing device to come online and approve this one…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }
})
