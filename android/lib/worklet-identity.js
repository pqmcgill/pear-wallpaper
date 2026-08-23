// Shared storageDir/deviceName construction for BOTH entry points that can
// start a Worklet: the resident one (worklet-client.js, started once from
// _layout.js) and the headless background round (background-sync.js,
// Task 9). These MUST agree byte-for-byte — the corestore is keyed off
// storageDir, so two different values would silently create two
// independent device identities on the same phone (the resident worklet's
// group membership would never be visible to the background round's, and
// vice versa). Extracted here specifically so neither call site can drift.
import * as Device from 'expo-device'
import { Paths } from 'expo-file-system'

export function getStorageDir () {
  return `${documentsPath()}/pear-wallpaper`
}

export function getDeviceName () {
  return Device.modelName || 'Android device'
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
