import { useState, useEffect } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DeviceList } from './DeviceList'
import { Received } from './Received'
import { Settings } from './Settings'
import { setWallpaper } from '../modules/wallpaper-setter'
import { getTarget } from '../lib/settings'

// Port of desktop/ui/components/MainView.js's tabbed composition, minus
// the Send tab — Android has no "pick a local file and send it" flow (out
// of this milestone's scope per the brief; YAGNI). Candidate
// accumulate/prune logic (from 'candidate' bridge events, pruned once the
// key shows up in snapshot.roster) is copied verbatim from desktop.
export function MainView ({ bridge, snapshot }) {
  const [tab, setTab] = useState('devices')
  const [candidates, setCandidates] = useState([])
  // QA finding (Task 7, on-device): MainView is the first screen whose
  // content is pinned to the very top of the window (every earlier screen
  // — Onboarding, Waiting — centers its content well below the status bar).
  // Without a top inset, the nav row rendered underneath the status bar:
  // visually, digits/icons from the status bar bled through the nav text
  // (confirmed via a cropped/zoomed screencap); functionally, taps landing
  // in that overlapped band never reached the Pressables at all — the
  // system status bar's touch area took priority over the app's content
  // drawn behind it, so every "Received"/"Settings" tap silently no-opped
  // (confirmed by a temporary console.log in each onPress that never
  // fired). expo-router's ExpoRoot wraps the tree in a SafeAreaProvider
  // already, so useSafeAreaInsets() needs no extra provider here.
  const insets = useSafeAreaInsets()

  useEffect(() => {
    bridge.on('candidate', (c) => {
      setCandidates((cs) => cs.some((x) => x.candidateKey === c.candidateKey) ? cs : [...cs, c])
    })
  }, [])

  const pruned = candidates.filter((c) => !snapshot.roster.some((d) => d.key === c.candidateKey))

  return (
    <View style={styles.main}>
      <View style={[styles.nav, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => setTab('devices')}>
          <Text style={tab === 'devices' ? styles.navActive : styles.navItem}>Devices</Text>
        </Pressable>
        <Pressable onPress={() => setTab('received')}>
          <Text style={tab === 'received' ? styles.navActive : styles.navItem}>Received</Text>
        </Pressable>
        <Pressable onPress={() => setTab('settings')}>
          <Text style={tab === 'settings' ? styles.navActive : styles.navItem}>Settings</Text>
        </Pressable>
      </View>
      {tab === 'devices' && <DeviceList bridge={bridge} snapshot={snapshot} candidates={pruned} />}
      {tab === 'received' && <Received snapshot={snapshot} setter={setWallpaper} getTarget={getTarget} />}
      {tab === 'settings' && <Settings bridge={bridge} snapshot={snapshot} />}
    </View>
  )
}

const styles = StyleSheet.create({
  main: { flex: 1 },
  nav: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  navItem: { fontSize: 16 },
  navActive: { fontSize: 16, fontWeight: 'bold' }
})
