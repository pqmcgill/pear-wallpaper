import { useState } from 'react'
import { View, Text, Switch, StyleSheet } from 'react-native'
import { getSettings, setSettings } from '../lib/settings'

// Port of desktop/ui/components/Settings.js. Two differences, both by
// design (spec'd in the brief), not judgment calls:
//   - the lock-screen toggle is new here and desktop-absent: it's pure
//     local shell state (lib/settings.js), no bridge call at all.
//   - the login-at-login toggle is kept structurally identical to
//     desktop's (same bridge.call('setLoginAtLogin', checked)), but only
//     renders when `loginAtLogin` is actually a key on the snapshot.
//     bridge-main.js's snapshot() omits the key entirely when no
//     `loginItem` was passed to createBridgeMain — true for every Android
//     build (worklet/host.js never constructs one) — so in practice this
//     branch never renders on-device, but the code stays parallel to
//     desktop rather than being deleted, in case a future platform (or a
//     future Android login-item concept) needs it.
export function Settings ({ bridge, snapshot }) {
  const [lockScreen, setLockScreen] = useState(() => getSettings().lockScreen)
  const [toggleError, setToggleError] = useState(null)

  const onToggleLockScreen = (value) => {
    try {
      setToggleError(null)
      setSettings({ lockScreen: value })
      setLockScreen(value)
    } catch (err) {
      setToggleError(err.message)
    }
  }

  const setLoginAtLogin = async (checked) => {
    try {
      setToggleError(null)
      await bridge.call('setLoginAtLogin', checked)
    } catch (err) {
      setToggleError(err.message)
    }
  }

  const hasLoginAtLogin = Object.prototype.hasOwnProperty.call(snapshot, 'loginAtLogin')
  const lastSync = snapshot.lastSync ? new Date(snapshot.lastSync).toLocaleString() : 'never'

  return (
    <View style={styles.section}>
      <Text>Device name: <Text style={styles.strong}>{snapshot.deviceName}</Text></Text>
      <Text selectable style={styles.deviceKey}>Device key: {snapshot.deviceKey}</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Apply to lock screen too</Text>
        <Switch value={lockScreen} onValueChange={onToggleLockScreen} />
      </View>

      {hasLoginAtLogin && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Launch at login</Text>
          <Switch value={!!snapshot.loginAtLogin} onValueChange={setLoginAtLogin} />
        </View>
      )}

      <Text style={styles.lastSync}>Last synced: {lastSync}</Text>
      {toggleError && <Text style={styles.error}>{toggleError}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  strong: { fontWeight: 'bold' },
  deviceKey: { marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  rowLabel: { flex: 1 },
  lastSync: { marginTop: 24 },
  error: { marginTop: 12, color: 'crimson' }
})
