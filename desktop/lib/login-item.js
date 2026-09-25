const fs = require('fs')
const path = require('path')
const os = require('os')

const defaultDir = path.join(os.homedir(), 'Library', 'LaunchAgents')

function xmlEscape (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function plistBody (label, programArguments) {
  const args = programArguments.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`
}

// Only the plist file is touched: launchd loads ~/Library/LaunchAgents at the
// next login. Bootstrapping now would start a second copy (RunAtLoad), and
// booting out would SIGTERM the running app when it was itself launched by
// this job.
function createLoginItem ({
  dir = defaultDir,
  label = 'com.pear-wallpaper',
  programArguments
} = {}) {
  const plistPath = path.join(dir, label + '.plist')
  return {
    async enable () {
      if (!programArguments || !programArguments.length) throw new Error('programArguments required to enable')
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(plistPath, plistBody(label, programArguments))
    },
    async disable () {
      await fs.promises.rm(plistPath, { force: true })
    },
    async isEnabled () {
      try { await fs.promises.access(plistPath); return true } catch { return false }
    }
  }
}

module.exports = { createLoginItem }
