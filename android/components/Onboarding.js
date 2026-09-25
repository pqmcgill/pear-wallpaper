import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { ScanInvite } from './ScanInvite'

// Maps a joinGroup() rejection's Error#message to user-facing copy — mirrors
// desktop/ui/components/Onboarding.js's JOIN_ERROR_MESSAGES (same lookup-key
// fix applied here — see below).
// joinGroup rejects (it never resolves the "denied" case as a success) with
// one of the blind-pairing coded errors, a supersede message, or 'closed'.
const JOIN_ERROR_MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.',
  'superseded by a newer invite': 'That join attempt was replaced by a newer one.',
  closed: 'The connection closed before joining finished.'
}

// QA finding (Task 5, on-device, real deny from a scripted desktop peer):
// blind-pairing-core's coded errors format Error#message as `${code}:
// ${msg}` (e.g. 'PAIRING_REJECTED: Pairing was rejected'), not the bare
// code — and bridge-main/bridge-ui only relay `.message` across the wire,
// dropping `.code`. An exact-match lookup on `message` therefore never hit
// PAIRING_REJECTED/INVITE_USED/INVITE_EXPIRED; every rejection silently fell
// through to the generic fallback. Matching by prefix fixes it for the
// coded cases while still exact-matching the plain 'superseded by a newer
// invite'/'closed' messages (a full-string match is also a valid prefix
// match). Confirmed via docs/notes/qa-android.md Act 2's live deny.
function friendlyJoinError (message) {
  const code = message && Object.keys(JOIN_ERROR_MESSAGES).find((c) => message.startsWith(c))
  return (code && JOIN_ERROR_MESSAGES[code]) || 'Could not join. Ask for a fresh invite.'
}

export function Onboarding ({ bridge, dispatch }) {
  const [createError, setCreateError] = useState(null)
  const [joinValue, setJoinValue] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const create = async () => {
    setCreateError(null)
    try {
      await bridge.call('createGroup')
    } catch (err) {
      setCreateError(err.message)
    }
  }

  // Shared by the paste field's "Join a group" button and ScanInvite's
  // onScanned. Sets local joinError for the case where this component is
  // still mounted when the rejection lands (e.g. a garbage/malformed
  // invite that never opens a real connection — confirmed on-device, see
  // qa-android.md Act 2). But a *successful* candidate connection fires
  // core's 'roster-changed' immediately (core/index.js's _onConnection),
  // which reaches here as a 'state' push with groupStatus 'joining' well
  // before this promise settles — routing away to Waiting and unmounting
  // this component. So the rejection is ALSO dispatched into shared
  // snapshot.joinError (the raw code, matching Waiting's own MESSAGES
  // map) — the only way a live deny/INVITE_USED/INVITE_EXPIRED is visible
  // once Waiting has replaced this screen. Uses the dedicated
  // 'join-error' action, NOT 'error' — 'error' also sets lastError,
  // which would pop a redundant, unfriendly ErrorBanner on top of this
  // component's own already-friendly copy in the garbage-invite case
  // (review-caught regression).
  const attemptJoin = async (value) => {
    setJoinError(null)
    setJoining(true)
    dispatch?.({ type: 'join-start' })
    try {
      await bridge.call('joinGroup', value)
    } catch (err) {
      setJoinError(friendlyJoinError(err.message))
      dispatch?.({ type: 'join-error', payload: { message: err.message } })
    } finally {
      setJoining(false)
    }
  }

  const join = () => attemptJoin(joinValue.trim())

  const handleScanned = (invite) => {
    setScanning(false)
    attemptJoin(invite.trim())
  }

  if (scanning) {
    return <ScanInvite onScanned={handleScanned} onCancel={() => setScanning(false)} />
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Pear Wallpaper</Text>
      <View style={styles.block}>
        <Pressable onPress={create}>
          <Text>Create a group</Text>
        </Pressable>
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
        <Pressable onPress={() => setScanning(true)} disabled={joining}>
          <Text>Scan invite</Text>
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
  error: { marginTop: 8, color: 'crimson' }
})
