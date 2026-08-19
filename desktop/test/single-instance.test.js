const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const { createLock } = require('../lib/single-instance.js')

test('second acquire on a held lock fails; release frees it', async (t) => {
  const dir = await tmp(t)
  const lp = path.join(dir, 'app.lock')
  const a = createLock(lp)
  const b = createLock(lp)
  t.ok(a.acquire(), 'first acquire succeeds')
  t.absent(b.acquire(), 'second acquire fails while held')
  a.release()
  t.ok(b.acquire(), 'acquire succeeds after release')
  b.release()
})

test('a stale lock (dead pid) is reclaimed', async (t) => {
  const dir = await tmp(t)
  const lp = path.join(dir, 'app.lock')
  fs.writeFileSync(lp, '999999999') // a pid that is not alive
  const a = createLock(lp)
  t.ok(a.acquire(), 'reclaims stale lock')
  a.release()
})

test('a malformed lockfile (non-numeric) is reclaimed', async (t) => {
  const dir = await tmp(t)
  const lp = path.join(dir, 'app.lock')
  fs.writeFileSync(lp, 'not-a-pid')
  const a = createLock(lp)
  t.ok(a.acquire(), 'reclaims malformed lock')
  a.release()
})
