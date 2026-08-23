const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Tasks 3-4 land `bridge/` and `core/` as file: dependencies, symlinked into
// android/node_modules. Metro only watches symlink targets it's told about
// explicitly, so point it at the real paths up front.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(__dirname, '../bridge'),
  path.resolve(__dirname, '../core')
]

module.exports = config
