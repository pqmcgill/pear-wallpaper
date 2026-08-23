import { useContext } from 'react'
import { View, StyleSheet } from 'react-native'
import { SnapshotContext } from './_layout'
import { Onboarding } from '../components/Onboarding'
import { Waiting } from '../components/Waiting'
import { MainView } from '../components/MainView'
import { ErrorBanner } from '../components/ErrorBanner'

// Routes on snapshot.groupStatus, mirroring desktop/ui/app.js's routedView().
//
// QA finding (Task 5, on-device): core's _onConnection emits
// 'roster-changed' the moment a gated connection opens on EITHER side —
// including the joiner's own candidate socket while blind-pairing is still
// in flight (core/index.js). bridge-main forwards that as a 'state' push,
// so a LIVE interactive join (not just a restart-resumed one) routes here
// to Waiting well before joinGroup()'s promise settles — contrary to the
// comment this file (and desktop/ui/app.js) inherited, which assumed
// Onboarding stays mounted for the whole interactive attempt. Confirmed via
// the scripted desktop peer denying a live candidate: Onboarding's local
// joinError landed on an already-unmounted tree and was never seen. Fixing
// it here for Android — dispatch is passed to Onboarding so its
// attemptJoin() catch also routes the raw rejection into shared
// snapshot.joinError, the only state Waiting can see once it has replaced
// Onboarding. See docs/notes/qa-android.md Act 2 for the reproduction.
function routedView (snapshot, bridge, dispatch) {
  if (snapshot.groupStatus === 'joining') return <Waiting snapshot={snapshot} />
  if (snapshot.groupStatus === 'member') return <MainView bridge={bridge} snapshot={snapshot} />
  return <Onboarding bridge={bridge} dispatch={dispatch} />
}

export default function Index () {
  const { snapshot, dispatch, bridge } = useContext(SnapshotContext)

  return (
    <View style={styles.root}>
      {snapshot.lastError && (
        <ErrorBanner
          message={snapshot.lastError}
          onDismiss={() => dispatch({ type: 'dismiss-error' })}
        />
      )}
      {routedView(snapshot, bridge, dispatch)}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
