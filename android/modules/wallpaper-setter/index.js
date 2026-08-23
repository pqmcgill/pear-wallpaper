import { requireNativeModule } from 'expo-modules-core'

// Lazy, not top-level: requireNativeModule() throws under jest (no native
// module registered in that environment) — resolving it only when
// setWallpaper is actually called keeps this file importable by _layout.js
// in tests that never trigger an apply pass (e.g. smoke.test.js).
let native = null
export function setWallpaper (filePath, target = 'home') {
  if (!native) native = requireNativeModule('WallpaperSetter')
  return native.setWallpaper(filePath, target)
}
