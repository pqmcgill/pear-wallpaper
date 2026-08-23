import { View, Text, Pressable, StyleSheet } from 'react-native'

// Renders snapshot.lastError (set by app/_layout.js's bridge 'error'
// listener) as a dismissible banner. Mirrors
// desktop/ui/components/ErrorBanner.js: before that component existed,
// lastError was stored but never rendered anywhere, so engine/apply/
// auto-resume-join failures were silently invisible to the user.
export function ErrorBanner ({ message, onDismiss }) {
  if (!message) return null
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onDismiss} accessibilityLabel="Dismiss">
        <Text style={styles.dismiss}>×</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fbeaea',
    padding: 12
  },
  message: { flex: 1, color: '#8a1f1f' },
  dismiss: { paddingHorizontal: 8, fontSize: 18, color: '#8a1f1f' }
})
