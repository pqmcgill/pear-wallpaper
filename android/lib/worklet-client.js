import { Worklet } from 'react-native-bare-kit'
import { createDuplexJsonTransport } from 'pear-wallpaper-bridge/transport'
import { createBridgeUi } from 'pear-wallpaper-bridge/ui'
import * as Device from 'expo-device'
import { Paths } from 'expo-file-system'
// bare-pack's --out .../worklet.bundle.mjs (bundle:worklet script) is an ES
// module wrapper whose default export is the raw bundle source string
// (bare-pack README's "bundle format" table: `bundle.mjs` -> ".bundle.mjs"
// -> "ES module wrapper for a .bundle") — the same string shape Worklet#start
// accepts as `source`. This mirrors the template echo screen's inline
// `worklet.start(path, source)` call, just with a generated bundle instead
// of a literal string.
import bundle from '../app/gen/worklet.bundle.mjs'

let instance = null

export function getBridge () {
  if (instance) return instance.bridge

  const worklet = new Worklet()
  worklet.start('/worklet.bundle', bundle)

  const transport = createDuplexJsonTransport(worklet.IPC)
  const bridge = createBridgeUi(transport)

  // Terminal-error contract (worklet/host.js): a failed init frame makes the
  // Bare process exit(1) — 'ready' never fires for that instance and a
  // second init frame on it would be ignored forever. Once 'ready' has
  // fired, later 'error' evts are ordinary operational errors forwarded by
  // bridge-main (engine failures, auto-resume-join failures, etc.) and do
  // NOT mean the process died, so the singleton must survive those — only
  // clear it for an error that arrives before 'ready' ever did.
  let ready = false
  bridge.on('ready', () => { ready = true })
  // No in-app retry is wired to this — deliberately. storageDir/deviceName
  // are static for the process lifetime, so a fresh Worklet started with
  // the same inputs would fail identically; the only real recovery is
  // fixing whatever made storage unwritable (or restarting the app) after
  // the terminal error surfaces via lastError. Clearing the singleton here
  // just means the NEXT cold getBridge() call — a later screen mounting,
  // Task 9's background path, or a restarted app — starts clean instead of
  // handing back a bridge wired to a dead Worklet.
  bridge.on('error', () => { if (!ready) instance = null })

  // init MUST precede any bridge.call (host ignores bridge frames pre-init)
  transport.send({
    t: 'init',
    storageDir: `${documentsPath()}/pear-wallpaper`,
    deviceName: Device.modelName || 'Android device'
  })

  instance = { worklet, bridge, transport }
  return bridge
}

export function getWorklet () {
  return instance ? instance.worklet : null
}

// expo-file-system (SDK 54+) dropped the string constant `documentDirectory`
// for `Paths.document`, a Directory whose `.uri` is a file:// URI (Android's
// native constant is literally `Uri.fromFile(context.filesDir).toString()`).
// The worklet's corestore (core/index.js: `new Corestore(storageDir + ...)`)
// wants a plain filesystem path, same as desktop's `app.getPath('userData')`
// — so the scheme is stripped here rather than passed through.
function documentsPath () {
  return Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '')
}
