const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const { resolveDeviceName } = require('../lib/device-name.js')

test('defaults to hostname and persists it', async (t) => {
  const dir = await tmp(t)
  const name = resolveDeviceName({ storageDir: dir, fs, hostname: () => 'Mac-Studio' })
  t.is(name, 'Mac-Studio')
  t.is(fs.readFileSync(path.join(dir, 'device-name.txt'), 'utf8'), 'Mac-Studio')
})

test('returns the persisted value on later calls (ignores hostname)', async (t) => {
  const dir = await tmp(t)
  fs.writeFileSync(path.join(dir, 'device-name.txt'), 'Living-Room')
  t.is(resolveDeviceName({ storageDir: dir, fs, hostname: () => 'Mac-Studio' }), 'Living-Room')
})

test('falls back to hostname when file contains only whitespace', async (t) => {
  const dir = await tmp(t)
  fs.writeFileSync(path.join(dir, 'device-name.txt'), '   ')
  t.is(resolveDeviceName({ storageDir: dir, fs, hostname: () => 'Fallback-Host' }), 'Fallback-Host')
})
