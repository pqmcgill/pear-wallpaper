import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import htm from 'htm'
import { DeviceList } from './DeviceList.js'
import { Send } from './Send.js'
import { Received } from './Received.js'
import { Settings } from './Settings.js'
const html = htm.bind(h)

// Task 8's MainView stub is replaced here with the real tabbed composition.
// Candidates accumulate from 'candidate' events (bridge-main pushes one per
// core 'pairing-request') and are pruned once the candidate's key shows up
// in snapshot.roster (approved-and-joined), so a stale candidate row can't
// outlive its resolution across state refreshes.
export function MainView ({ bridge, snapshot }) {
  const [tab, setTab] = useState('devices')
  const [candidates, setCandidates] = useState([])

  useEffect(() => {
    bridge.on('candidate', (c) => {
      setCandidates((cs) => cs.some((x) => x.candidateKey === c.candidateKey) ? cs : [...cs, c])
    })
  }, [])

  const pruned = candidates.filter((c) => !snapshot.roster.some((d) => d.key === c.candidateKey))

  return html`
    <div class="main">
      <nav>
        <button onClick=${() => setTab('devices')}>Devices</button>
        <button onClick=${() => setTab('send')}>Send</button>
        <button onClick=${() => setTab('received')}>Received</button>
        <button onClick=${() => setTab('settings')}>Settings</button>
      </nav>
      ${tab === 'devices' && html`<${DeviceList} bridge=${bridge} snapshot=${snapshot} candidates=${pruned} />`}
      ${tab === 'send' && html`<${Send} bridge=${bridge} snapshot=${snapshot} />`}
      ${tab === 'received' && html`<${Received} bridge=${bridge} snapshot=${snapshot} />`}
      ${tab === 'settings' && html`<${Settings} bridge=${bridge} snapshot=${snapshot} />`}
    </div>`
}
