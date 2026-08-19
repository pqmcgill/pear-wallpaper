const fs = require('fs')

function isAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function createLock (lockPath) {
  let held = false
  return {
    acquire () {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fd = fs.openSync(lockPath, 'wx') // exclusive create
          fs.writeSync(fd, String(process.pid))
          fs.closeSync(fd)
          held = true
          return true
        } catch (err) {
          if (err.code !== 'EEXIST') throw err
          const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10)
          if (Number.isFinite(owner) && isAlive(owner)) return false
          try { fs.unlinkSync(lockPath) } catch {} // stale; reclaim and retry
        }
      }
      return false
    },
    release () {
      if (!held) return
      try { fs.unlinkSync(lockPath) } catch {}
      held = false
    }
  }
}

module.exports = { createLock }
