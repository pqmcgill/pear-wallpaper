import { View, Text, StyleSheet } from 'react-native'

// Originally documented as covering only the restart-resumed-join path
// (the worklet resumes a pending join on startup and, if it fails, emits a
// bare 'error-joining' signal via bridge-main.js). QA finding (Task 5,
// on-device): that's incomplete. core's _onConnection emits
// 'roster-changed' the moment a gated connection opens on EITHER side,
// including the joiner's own candidate socket while blind-pairing is still
// in flight — so bridge-main pushes a 'state' evt with groupStatus
// 'joining' well before a LIVE joinGroup() call settles, and this screen
// (not Onboarding) is what's mounted when the rejection lands. Onboarding
// forwards it into snapshot.joinError for exactly that reason (see its
// attemptJoin). So this map's codes now arrive from both paths. Mirrors
// desktop/ui/components/Waiting.js (which has the same latent gap — not
// fixed there in this task).
const MESSAGES = {
  PAIRING_REJECTED: 'The creator denied this device.',
  INVITE_USED: 'That invite was already used. Ask for a fresh one.',
  INVITE_EXPIRED: 'That invite expired. Ask for a fresh one.'
}

// blind-pairing-core's coded errors format Error#message as `${code}:
// ${msg}` (e.g. 'PAIRING_REJECTED: Pairing was rejected'), not the bare
// code, and bridge-main/bridge-ui only relay `.message` — an exact-match
// lookup never hit. Prefix match instead (confirmed via a live deny in
// docs/notes/qa-android.md Act 2).
function friendlyMessage (message) {
  const code = message && Object.keys(MESSAGES).find((c) => message.startsWith(c))
  return (code && MESSAGES[code]) || 'Could not join. Ask for a fresh invite.'
}

export function Waiting ({ snapshot }) {
  const err = snapshot.joinError
  if (err) {
    return (
      <View style={styles.section}>
        <Text>{friendlyMessage(err)}</Text>
        {/* Whether this was a live interactive rejection or a resumed one
            (see the comment above), core's _runJoin finally always resets
            groupStatus to 'none' internally — but no state push tells this
            snapshot that, so there is no in-app control that gets back to
            Onboarding. Restarting re-reads state fresh (and never retries
            the now-cleared dead invite — see core/index.js's
            _open()/pending-invite cleanup). */}
        <Text style={styles.retry}>
          Ask the creator for a fresh invite, then restart the app and paste it to try again.
        </Text>
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
  section: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  retry: { marginTop: 8, textAlign: 'center' }
})
