import { File, Paths } from 'expo-file-system'

// Local-only preference — no bridge/protocol involvement, unlike everything
// else this shell reads from the worklet's snapshot. `lockScreen` decides
// whether an apply (automatic, via Task 6's controller, or a manual
// Received reapply) also sets the lock-screen wallpaper.
const DEFAULTS = { lockScreen: false }

// Same expo-file-system API family as worklet-client.js's Paths.document
// usage (Task 4) — a File under the documents dir, not the corestore's
// storageDir (this is shell-local UI state, not synced core data).
function settingsFile () {
  return new File(Paths.document, 'settings.json')
}

export function getSettings () {
  const file = settingsFile()
  if (!file.exists) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(file.textSync()) }
  } catch {
    // Corrupt/empty file — fall back rather than throw, same spirit as
    // apply-controller's swallow-and-retry: a bad settings file shouldn't
    // brick the settings screen.
    return { ...DEFAULTS }
  }
}

export function setSettings (patch) {
  const next = { ...getSettings(), ...patch }
  const file = settingsFile()
  if (!file.exists) file.create()
  file.write(JSON.stringify(next))
  return next
}

// Consumed by Task 6's createApplyController (getTarget) and by Received's
// manual reapply — both need the exact same lock-screen preference applied
// consistently, automatic or manual.
export function getTarget () {
  return getSettings().lockScreen ? 'both' : 'home'
}
