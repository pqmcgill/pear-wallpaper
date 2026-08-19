const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)

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

function createLoginItem ({
  exec = (cmd, args) => execFileP(cmd, args),
  dir = defaultDir,
  label = 'com.pear-wallpaper',
  programArguments
} = {}) {
  const plistPath = path.join(dir, label + '.plist')
  const domain = `gui/${process.getuid()}`
  return {
    async enable () {
      if (!programArguments || !programArguments.length) throw new Error('programArguments required to enable')
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(plistPath, plistBody(label, programArguments))
      await exec('launchctl', ['bootstrap', domain, plistPath])
    },
    async disable () {
      try { await exec('launchctl', ['bootout', `${domain}/${label}`]) } catch {}
      try { await fs.promises.unlink(plistPath) } catch {}
    },
    async isEnabled () {
      try { await exec('launchctl', ['print', `${domain}/${label}`]); return true } catch { return false }
    }
  }
}

module.exports = { createLoginItem }
