const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')

async function makeTestnet(t, n = 10) {
  return createTestnet(n, t)
}

function tmpDir(t) {
  return tmp(t)
}

// Wait until an (optionally async) predicate holds, re-checking on every
// emitter event (autopass's updateUntil pattern, async-capable). A 10s
// safety timeout turns a silent hang into a loud test failure.
async function until(emitter, event, fn, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (await fn()) return
    if (Date.now() > deadline) throw new Error(`until(${event}): timed out`)
    await new Promise((resolve) => {
      const timer = setTimeout(done, 250) // also poll: events can fire before we listen
      emitter.once(event, done)
      function done() {
        clearTimeout(timer)
        emitter.off(event, done)
        resolve()
      }
    })
  }
}

// Let pending promises/io settle
function eventFlush() {
  return new Promise((resolve) => setImmediate(resolve))
}

module.exports = { makeTestnet, tmpDir, until, eventFlush }
