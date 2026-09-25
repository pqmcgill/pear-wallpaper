import { useContext, useState } from 'react'
import { View, Text, Image, Switch, Pressable, StyleSheet } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SnapshotContext } from './_layout'
import { deleteStagedFile } from '../lib/share-target'

// Android port of desktop/ui/components/Send.js's target-selection logic
// (same self-filtered roster, same "chosen = the keys currently checked"
// shape). The one deliberate divergence, per the brief (YAGNI — no in-app
// picker): Android's file never comes from a browse/drag-drop step: it
// arrives pre-staged via the OS share sheet (_layout.js's share-intent
// hook -> lib/share-target.js's stageSharedImage()) and reaches this screen
// as the `filePath` route param the default export below reads. This
// exported function is what test/send-screen.test.js renders directly
// (bridge/snapshot/filePath/onSent as plain props), same convention as
// every other components/*.js test in this app.
// Best-effort: a failure to remove the staged file must never block a send
// or a cancel (stageSharedImage's own reap-on-next-share is the backstop).
function discardStaged (filePath) {
  try {
    deleteStagedFile(filePath)
  } catch (err) {
    console.warn('pear-wallpaper: failed to delete staged file', err)
  }
}

export function SendScreen ({ bridge, snapshot, filePath, filename, onSent, onCancel }) {
  const [targets, setTargets] = useState({})
  const [sendError, setSendError] = useState(null)
  const [sending, setSending] = useState(false)
  const targetable = (snapshot.roster || []).filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])

  const send = async () => {
    setSendError(null)
    setSending(true)
    try {
      // null, not the staged file's generated name, when the share had none.
      await bridge.call('sendWallpaper', { filePath, targets: chosen, filename: filename || null })
      // core has its own copy of the image in hyperblobs by now.
      discardStaged(filePath)
      onSent?.()
    } catch (err) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  const cancel = () => {
    discardStaged(filePath)
    onCancel?.()
  }

  const disabled = !filePath || chosen.length === 0 || sending

  return (
    <View style={styles.section}>
      {filePath && <Image source={{ uri: 'file://' + filePath }} style={styles.preview} />}
      {targetable.length === 0 && (
        <Text style={styles.empty}>
          {snapshot.groupStatus === 'member'
            ? 'No other devices in your group yet. Invite one from Devices, then share the picture again.'
            : 'Join a group first, then share the picture again.'}
        </Text>
      )}
      {targetable.map((d) => (
        <View style={styles.row} key={d.key}>
          <Text style={styles.rowLabel}>{d.name}</Text>
          <Switch
            value={!!targets[d.key]}
            onValueChange={(value) => setTargets({ ...targets, [d.key]: value })}
          />
        </View>
      ))}
      <View style={styles.actions}>
        <Pressable onPress={cancel} disabled={sending}>
          <Text style={styles.action}>Cancel</Text>
        </Pressable>
        <Pressable onPress={send} disabled={disabled}>
          <Text style={[styles.action, disabled && styles.disabled]}>{sending ? 'Sending…' : 'Send'}</Text>
        </Pressable>
      </View>
      {sendError && <Text style={styles.error}>{sendError}</Text>}
    </View>
  )
}

// The actual expo-router route: wires SendScreen to the real bridge/snapshot
// (via the same SnapshotContext every other screen consumes, through
// app/index.js) and the staged filePath that _layout.js's share-intent hook
// passed as this route's search param. onSent navigates back to Main's Sent
// tab, where bridge-main's 'send-updated' state pushes keep each target's
// delivery status current.
export default function Send () {
  const { bridge, snapshot } = useContext(SnapshotContext)
  const { filePath, filename } = useLocalSearchParams()
  const router = useRouter()

  return (
    <SendScreen
      bridge={bridge}
      snapshot={snapshot}
      filePath={filePath}
      filename={filename}
      onSent={() => router.replace({ pathname: '/', params: { tab: 'sent' } })}
      onCancel={() => router.replace('/')}
    />
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  preview: { width: '100%', height: 200, marginBottom: 24, resizeMode: 'contain' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  rowLabel: { flex: 1 },
  empty: { marginBottom: 24 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  action: { fontSize: 16 },
  disabled: { opacity: 0.4 },
  error: { marginTop: 12, color: 'crimson' }
})
