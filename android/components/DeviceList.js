import { useState, useEffect } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { qrSvg } from '../lib/qr'

// Port of desktop/ui/components/DeviceList.js. Same three actions
// (createInvite, approve/deny a candidate, removeDevice), same
// self/creator gating logic — only the rendering swaps preact/htm for RN
// primitives and desktop's dangerouslySetInnerHTML QR for react-native-svg's
// SvgXml. `candidates` is passed down already-pruned, same contract as
// desktop's MainView -> DeviceList.
export function DeviceList ({ bridge, snapshot, candidates }) {
  const [invite, setInvite] = useState(null)
  const [actionError, setActionError] = useState(null)
  const self = snapshot.roster.find((d) => d.isSelf)
  const amCreator = !!(self && self.isCreator)
  const alone = snapshot.roster.every((d) => d.isSelf)

  const onCreateInvite = async () => {
    try {
      setActionError(null)
      setInvite(await bridge.call('createInvite'))
    } catch (err) {
      setActionError(err.message)
    }
  }
  // A creator with no one else in the group has one thing to do next, so
  // show the invite without making them find the button. createInvite hands
  // back the current unexpired invite, so remounting does not mint another.
  useEffect(() => {
    if (amCreator && alone) onCreateInvite()
  }, [amCreator, alone])

  const onRemove = async (key) => {
    try {
      setActionError(null)
      await bridge.call('removeDevice', key)
    } catch (err) {
      setActionError(err.message)
    }
  }
  const onApprove = async (candidateKey) => {
    try {
      setActionError(null)
      await bridge.call('approve', candidateKey)
    } catch (err) {
      setActionError(err.message)
    }
  }
  const onDeny = async (candidateKey) => {
    try {
      setActionError(null)
      await bridge.call('deny', candidateKey)
    } catch (err) {
      setActionError(err.message)
    }
  }

  return (
    <View style={styles.section}>
      {snapshot.roster.map((d) => (
        <View style={styles.row} key={d.key}>
          <View style={[styles.dot, d.online ? styles.dotOn : styles.dotOff]} />
          <Text style={styles.rowText}>
            {d.name} {d.isSelf ? '(this device)' : ''} {d.isCreator ? '· creator' : ''}
          </Text>
          {amCreator && !d.isSelf && (
            <Pressable onPress={() => onRemove(d.key)}>
              <Text style={styles.action}>Remove</Text>
            </Pressable>
          )}
        </View>
      ))}

      {amCreator && candidates.map((c) => (
        <View style={styles.row} key={c.candidateKey}>
          <Text style={styles.rowText}>{c.name} wants to join</Text>
          <Pressable onPress={() => onApprove(c.candidateKey)}>
            <Text style={styles.action}>Approve</Text>
          </Pressable>
          <Pressable onPress={() => onDeny(c.candidateKey)}>
            <Text style={styles.action}>Deny</Text>
          </Pressable>
        </View>
      ))}

      {amCreator && (
        <View style={styles.inviteBlock}>
          {alone && <Text style={styles.hint}>Invite another device: scan this code with it, or paste the text into it.</Text>}
          <Pressable onPress={onCreateInvite}>
            <Text>New invite</Text>
          </Pressable>
          {invite && (
            <>
              <Text selectable style={styles.inviteText}>{invite}</Text>
              <SvgXml testID="invite-qr" xml={qrSvg(invite)} width={200} height={200} />
            </>
          )}
        </View>
      )}

      {actionError && <Text style={styles.error}>{actionError}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  rowText: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  dotOn: { backgroundColor: 'green' },
  dotOff: { backgroundColor: 'gray' },
  action: { marginLeft: 12, color: 'blue' },
  inviteBlock: { marginTop: 24 },
  hint: { marginBottom: 8 },
  inviteText: { marginTop: 8 },
  error: { marginTop: 12, color: 'crimson' }
})
