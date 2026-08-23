import { useState } from 'react'
import { View, Text, Image, Pressable, StyleSheet } from 'react-native'

// Port of desktop/ui/components/Received.js, with the one deliberate
// divergence the brief calls out: desktop's Reapply goes over the bridge
// (`bridge.call('reapply', id)`, bridge-main.js), because the platform
// setter lives in the Electron main process on that side of the wire.
// Android's native setter lives in-process (modules/wallpaper-setter), and
// the bridge `reapply` command doesn't exist without a worklet-side
// `platform` (bridge-main.js only registers it `...(platform ? { reapply }
// : {})`, and worklet/host.js never passes one) — so this component calls
// the setter directly, the same as Task 6's apply-controller, and never
// touches bridge.markApplied at all (this is a manual, user-initiated
// reapply of an already-delivered item, not a new pending item to ack).
export function Received ({ snapshot, setter, getTarget }) {
  const [reapplyError, setReapplyError] = useState(null)

  const reapply = async (item) => {
    try {
      setReapplyError(null)
      await setter(item.filePath, getTarget())
    } catch (err) {
      setReapplyError(err.message)
    }
  }

  return (
    <View style={styles.section}>
      {(snapshot.received || []).map((r) => (
        <View style={styles.row} key={r.id}>
          <Image source={{ uri: 'file://' + r.filePath }} style={styles.thumb} />
          <Text style={styles.rowText}>{(r.meta && r.meta.filename) || r.id}</Text>
          <Pressable onPress={() => reapply(r)}>
            <Text style={styles.action}>Re-apply</Text>
          </Pressable>
        </View>
      ))}
      {reapplyError && <Text style={styles.error}>{reapplyError}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  thumb: { width: 60, height: 60, marginRight: 12 },
  rowText: { flex: 1 },
  action: { marginLeft: 12, color: 'blue' },
  error: { marginTop: 12, color: 'crimson' }
})
