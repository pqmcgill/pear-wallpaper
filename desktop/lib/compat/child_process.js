'use strict'
// Minimal Node `child_process`-shaped compat shim for the Bare worker.
// Bare has no builtin 'child_process' module; process spawning under Bare
// goes through the `bare-subprocess` package instead (see
// node_modules/bare-subprocess/index.js — it exposes `spawn`/`spawnSync`,
// not `execFile`). `lib/platform/darwin.js` (reused, unmodified) does:
//   const { execFile } = require('child_process')
//   const { promisify } = require('util')
//   const execFileP = promisify(execFile)
//   await execFileP(cmd, args)                    // setWallpaper: ignores the resolved value
//   const { stdout } = await execFileP(cmd, args) // currentWallpaper() only
// `bare-utils`'s `promisify` (see desktop/package.json's "util" imports
// remap) is generic — it does not implement Node's `util.promisify.custom`
// special-casing that gives real `child_process.execFile` its
// `(stdout, stderr)` two-value resolution. So instead of mimicking Node's
// exact 3-arg `(err, stdout, stderr)` callback (which the generic promisify
// would flatten to just `stdout`, breaking darwin.js's `{ stdout }`
// destructure), this shim's callback resolves a single `{ stdout, stderr }`
// object as its second argument — satisfying both call sites without
// requiring changes to darwin.js.
const subprocess = require('bare-subprocess')

function execFile (file, args, callback) {
  const chunks = { stdout: [], stderr: [] }
  let child
  try {
    child = subprocess.spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    queueMicrotask(() => callback(err))
    return
  }

  let settled = false
  const done = (err, result) => {
    if (settled) return
    settled = true
    if (err) callback(err)
    else callback(null, result)
  }

  child.stdout.on('data', (chunk) => chunks.stdout.push(chunk))
  child.stderr.on('data', (chunk) => chunks.stderr.push(chunk))
  child.on('error', (err) => done(err))
  child.on('close', (code, signal) => {
    const stdout = Buffer.concat(chunks.stdout).toString('utf8')
    const stderr = Buffer.concat(chunks.stderr).toString('utf8')
    if (code !== 0) {
      const err = new Error(`Command failed: ${file} ${(args || []).join(' ')}\n${stderr}`)
      err.code = code
      err.signal = signal
      err.stdout = stdout
      err.stderr = stderr
      done(err)
    } else {
      done(null, { stdout, stderr })
    }
  })
}

module.exports = { execFile }
