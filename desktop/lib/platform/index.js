const { createDarwinPlatform } = require('./darwin.js')

function selectPlatform () {
  if (process.platform === 'darwin') return createDarwinPlatform()
  throw new Error(`unsupported platform: ${process.platform} (only darwin in this plan)`)
}

module.exports = { selectPlatform }
