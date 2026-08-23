import { useContext } from 'react'
import { View, StyleSheet } from 'react-native'
import { SnapshotContext } from './_layout'
import { Onboarding } from '../components/Onboarding'
import { Waiting } from '../components/Waiting'
import { MainView } from '../components/MainView'
import { ErrorBanner } from '../components/ErrorBanner'

// Routes on snapshot.groupStatus, mirroring desktop/ui/app.js's routedView().
function routedView (snapshot, bridge) {
  if (snapshot.groupStatus === 'joining') return <Waiting snapshot={snapshot} />
  if (snapshot.groupStatus === 'member') return <MainView bridge={bridge} snapshot={snapshot} />
  return <Onboarding bridge={bridge} />
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
      {routedView(snapshot, bridge)}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
