const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)

function defaultExec (cmd, args) { return execFileP(cmd, args) }

function createDarwinPlatform ({ exec = defaultExec } = {}) {
  return {
    // Pass the path via argv (not string-interpolated) to avoid AppleScript injection / quoting bugs.
    async setWallpaper (filePath) {
      await exec('osascript', [
        '-e', 'on run argv',
        '-e', 'set p to POSIX file (item 1 of argv)',
        '-e', 'tell application "System Events" to set picture of every desktop to p',
        '-e', 'end run',
        '--', filePath
      ])
    },
    async currentWallpaper () {
      const { stdout } = await exec('osascript', [
        '-e', 'tell application "System Events" to get picture of desktop 1'
      ])
      return String(stdout).trim()
    }
  }
}

module.exports = { createDarwinPlatform }
