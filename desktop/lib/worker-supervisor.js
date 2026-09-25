'use strict'
// Keeps one Bare worker alive for main.js. The pipe is PearRuntime.run()'s
// Duplex: newline-JSON frames in both directions, plus an 'exit' event when
// the bare process dies.
//
// status: 'running' | 'restarting' (between a crash and the respawn) |
// 'failed' (restart budget spent; only start() brings it back).

const RESTART_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
// A worker that stayed up this long crashed for a fresh reason, not as part
// of a startup crash loop, so it gets the whole budget again.
const STABLE_MS = 60000
const SHUTDOWN_GRACE_MS = 2000

function createWorkerSupervisor ({
  spawn,
  onFrame,
  onStatus,
  delays = RESTART_DELAYS_MS,
  stableMs = STABLE_MS,
  graceMs = SHUTDOWN_GRACE_MS,
  timers = { setTimeout, clearTimeout },
  now = Date.now,
  log = console.error
}) {
  let pipe = null
  let status = null
  let crashes = 0
  let startedAt = 0
  let restartTimer = null
  let stopping = false

  function setStatus (s) { status = s; onStatus(s) }

  function launch () {
    restartTimer = null
    const p = spawn()
    pipe = p
    startedAt = now()
    let buf = ''
    p.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line) continue
        let msg; try { msg = JSON.parse(line) } catch { continue }
        onFrame(msg)
      }
    })
    p.on('error', (err) => log('[pear-wallpaper] worker pipe error', err))
    p.on('exit', (code, signal) => onExit(p, code, signal))
    setStatus('running')
  }

  function onExit (p, code, signal) {
    if (p !== pipe) return
    pipe = null
    if (stopping) return
    log('[pear-wallpaper] worker exited', code, signal)
    if (now() - startedAt >= stableMs) crashes = 0
    if (crashes >= delays.length) { setStatus('failed'); return }
    restartTimer = timers.setTimeout(launch, delays[crashes++])
    setStatus('restarting')
  }

  return {
    get status () { return status },
    start () {
      if (pipe) return
      stopping = false
      crashes = 0
      if (restartTimer) { timers.clearTimeout(restartTimer); restartTimer = null }
      launch()
    },
    // false when there is no live worker to take the frame.
    write (msg) {
      if (!pipe) return false
      pipe.write(Buffer.from(JSON.stringify(msg) + '\n'))
      return true
    },
    // The shutdown frame lets the worker close core before it exits;
    // destroy() alone SIGTERMs it with no chance to clean up.
    stop () {
      stopping = true
      if (restartTimer) { timers.clearTimeout(restartTimer); restartTimer = null }
      const p = pipe
      if (!p) return Promise.resolve()
      return new Promise((resolve) => {
        const kill = () => { try { p.destroy() } catch { /* already closed */ } resolve() }
        const timer = timers.setTimeout(kill, graceMs)
        p.once('exit', () => { timers.clearTimeout(timer); resolve() })
        try {
          p.write(Buffer.from(JSON.stringify({ t: 'shutdown' }) + '\n'))
        } catch {
          timers.clearTimeout(timer); kill()
        }
      })
    }
  }
}

module.exports = { createWorkerSupervisor }
