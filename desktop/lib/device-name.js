const path = require('path')
const os = require('os')

function resolveDeviceName ({ storageDir, fs = require('fs'), hostname = () => os.hostname() }) {
  const file = path.join(storageDir, 'device-name.txt')
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {}
  const name = hostname()
  fs.mkdirSync(storageDir, { recursive: true })
  fs.writeFileSync(file, name)
  return name
}

module.exports = { resolveDeviceName }
