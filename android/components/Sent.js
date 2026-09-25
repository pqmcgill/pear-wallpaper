import { View, Text, StyleSheet } from 'react-native'

// The sender's view of snapshot.sends (core's listSends: this device's own
// sends, newest first, each target with a delivery status). Desktop shows
// the same list, in the same words, under its Send tab. Android's Send
// screen is transient (reached from the share sheet), so it lives here.
const STATUS = {
  pending: 'Not delivered yet',
  delivered: 'Delivered',
  superseded: 'Replaced by a newer picture'
}

export function Sent ({ snapshot }) {
  const sends = snapshot.sends || []
  const nameOf = (key) => {
    const device = snapshot.roster.find((d) => d.key === key)
    return device ? device.name : 'A removed device'
  }

  if (sends.length === 0) {
    return (
      <View style={styles.section}>
        <Text>Pictures you send will show up here.</Text>
      </View>
    )
  }

  return (
    <View style={styles.section}>
      {sends.map((s) => (
        <View style={styles.send} key={s.id}>
          <Text style={styles.when}>Sent {new Date(s.sentAt).toLocaleString()}</Text>
          {s.targets.map((t) => (
            <View style={styles.row} key={t.key}>
              <Text style={styles.rowText}>{nameOf(t.key)}</Text>
              <Text style={t.status === 'delivered' ? styles.delivered : styles.status}>{STATUS[t.status]}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { flex: 1, padding: 24 },
  send: { marginBottom: 20 },
  when: { fontWeight: 'bold', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  rowText: { flex: 1 },
  status: { color: 'gray' },
  delivered: { color: 'green' }
})
