import { View, Text, StyleSheet } from 'react-native'

// Placeholder — Task 4 only needs to prove the routing works once
// groupStatus is 'member'. Real tabs (Devices/Received/Settings) land in a
// later task (see docs/superpowers/plans/2026-08-23-android-shell.md).
export function MainView ({ snapshot }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Pear Wallpaper</Text>
      <Text>Devices in group: {snapshot.roster.length}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 }
})
