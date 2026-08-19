const WallpaperCore = require('pear-wallpaper-core')
const Runtime = require('pear-electron')
const Bridge = require('pear-bridge')

async function main () {
  const storageDir = Pear.config.storage // per-app, stable across updates
  const os = require('os')
  const core = new WallpaperCore({ storageDir, deviceName: os.hostname() })
  await core.ready()
  console.log('[pear-wallpaper] booted; deviceKey=', core.deviceKey, 'status=', core.groupStatus)

  // Window creation, per pear-electron README (v1.7.28): the main entrypoint
  // pairs a pear-bridge instance (serves ui/ assets over local HTTP) with the
  // pear-electron Runtime, which spawns/boots the actual Electron UI process.
  const bridge = new Bridge()
  await bridge.ready()
  const runtime = new Runtime()
  const pipe = runtime.start({ bridge })

  Pear.teardown(() => {
    pipe.end()
    return core.close()
  })
}

main().catch((err) => { console.error(err); Pear.exit(1) })
