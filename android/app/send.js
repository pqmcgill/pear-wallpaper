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
export function SendScreen ({ bridge, snapshot, filePath, onSent }) {
  const [targets, setTargets] = useState({})
  const [sendError, setSendError] = useState(null)
  const [sending, setSending] = useState(false)
  const targetable = (snapshot.roster || []).filter((d) => !d.isSelf)
  const chosen = Object.keys(targets).filter((k) => targets[k])

  const send = async () => {
    setSendError(null)
    setSending(true)
    try {
      await bridge.call('sendWallpaper', { filePath, targets: chosen })
      try {
        // Best-effort: sendWallpaper already succeeded and core has its own
        // copy of the image in hyperblobs by this point, so a failure to
        // remove the now-redundant staged file must never surface as a send
        // failure (stageSharedImage's own reap-on-next-share is the
        // backstop if this does fail).
        deleteStagedFile(filePath)
      } catch (err) {
        console.warn('pear-wallpaper: failed to delete staged file after send', err)
      }
      onSent?.()
    } catch (err) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <View style={styles.section}>
      {filePath && <Image source={{ uri: 'file://' + filePath }} style={styles.preview} />}
      {targetable.map((d) => (
        <View style={styles.row} key={d.key}>
          <Text style={styles.rowLabel}>{d.name}</Text>
          <Switch
            value={!!targets[d.key]}
            onValueChange={(value) => setTargets({ ...targets, [d.key]: value })}
          />
        </View>
      ))}
      <Pressable onPress={send} disabled={!filePath || chosen.length === 0 || sending}>
        <Text>{sending ? 'Sending…' : 'Send'}</Text>
      </Pressable>
      {sendError && <Text style={styles.error}>{sendError}</Text>}
    </View>
  )
}

// The actual expo-router route: wires SendScreen to the real bridge/snapshot
// (via the same SnapshotContext every other screen consumes, through
// app/index.js) and the staged filePath that _layout.js's share-intent hook
// passed as this route's search param. onSent navigates back to Main —
// bridge-main's own 'send-updated'/'state' events (already wired in
// _layout.js) then surface the send's status there, same as desktop's Send
// tab after a successful call.
export default function Send () {
  const { bridge, snapshot } = useContext(SnapshotContext)
  const { filePath } = useLocalSearchParams()
  const router = useRouter()

  return (
    <SendScreen
      bridge={bridge}
      snapshot={snapshot}
      filePath={filePath}
      onSent={() => router.replace('/')}
    />
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  preview: { width: '100%', height: 200, marginBottom: 24, resizeMode: 'contain' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  rowLabel: { flex: 1 },
  error: { marginTop: 12, color: 'crimson' }
})
