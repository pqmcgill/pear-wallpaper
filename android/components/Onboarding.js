import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'

// Maps a joinGroup() rejection's Error#message to user-facing copy — mirrors
// desktop/ui/components/Onboarding.js's JOIN_ERROR_MESSAGES verbatim.
// joinGroup rejects (it never resolves the "denied" case as a success) with
// one of the blind-pairing coded errors, a supersede message, or 'closed'.
const JOIN_ERROR_MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.',
  'superseded by a newer invite': 'That join attempt was replaced by a newer one.',
  closed: 'The connection closed before joining finished.'
}

function friendlyJoinError (message) {
  return JOIN_ERROR_MESSAGES[message] || 'Could not join. Ask for a fresh invite.'
}

export function Onboarding ({ bridge }) {
  const [invite, setInvite] = useState(null)
  const [createError, setCreateError] = useState(null)
  const [joinValue, setJoinValue] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const create = async () => {
    setCreateError(null)
    try {
      await bridge.call('createGroup')
      setInvite(await bridge.call('createInvite'))
    } catch (err) {
      setCreateError(err.message)
    }
  }

  const join = async () => {
    setJoinError(null)
    setJoining(true)
    try {
      await bridge.call('joinGroup', joinValue.trim())
    } catch (err) {
      setJoinError(friendlyJoinError(err.message))
    } finally {
      setJoining(false)
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Pear Wallpaper</Text>
      <View style={styles.block}>
        <Pressable onPress={create}>
          <Text>Create a group</Text>
        </Pressable>
        {invite && <Text selectable style={styles.invite}>{invite}</Text>}
        {createError && <Text style={styles.error}>{createError}</Text>}
      </View>
      <View style={styles.block}>
        <TextInput
          placeholder="Paste invite"
          value={joinValue}
          onChangeText={setJoinValue}
          editable={!joining}
        />
        <Pressable onPress={join} disabled={joining}>
          <Text>{joining ? 'Joining…' : 'Join a group'}</Text>
        </Pressable>
        {joinError && <Text style={styles.error}>{joinError}</Text>}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 },
  block: { marginBottom: 24 },
  invite: { marginTop: 8 },
  error: { marginTop: 8, color: 'crimson' }
})
