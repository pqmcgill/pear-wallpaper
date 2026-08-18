const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const WallpaperCore = require('../index.js')

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

// Two members, fully paired: creator with a group, joiner admitted via an
// auto-approved invite. Shared by tests that need a live roster of two
// rather than exercising the pairing flow itself (that's Task 4/5's job).
async function pairedDuo(t) {
  const tn = await makeTestnet(t)
  const creator = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'creator', bootstrap: tn.bootstrap })
  await creator.ready()
  await creator.createGroup()
  t.teardown(() => creator.close())
  const joiner = new WallpaperCore({ storageDir: await tmpDir(t), deviceName: 'phone', bootstrap: tn.bootstrap })
  await joiner.ready()
  t.teardown(() => joiner.close())
  const invite = await creator.createInvite()
  creator.on('pairing-request', ({ candidateKey }) => creator.approve(candidateKey))
  await joiner.joinGroup(invite)
  return { creator, joiner, tn }
}

module.exports = { makeTestnet, tmpDir, until, eventFlush, pairedDuo }
