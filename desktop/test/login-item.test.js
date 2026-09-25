const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)
const { createLoginItem } = require('../lib/login-item.js')

const domain = `gui/${process.getuid()}`
const loaded = (label) => execFileP('launchctl', ['print', `${domain}/${label}`]).then(() => true, () => false)

test('enable and disable only change the plist; the launchd job is left alone until next login', async (t) => {
  const dir = await tmp(t)
  const marker = path.join(dir, 'ran.txt')
  const label = 'com.pearwallpaper.test.' + process.pid
  const plist = path.join(dir, label + '.plist')
  t.teardown(() => execFileP('launchctl', ['bootout', `${domain}/${label}`]).catch(() => {}))
  const li = createLoginItem({ dir, label, programArguments: ['/usr/bin/touch', marker] })

  t.absent(await li.isEnabled(), 'not enabled initially')
  await li.enable()
  await li.enable()
  t.ok(await li.isEnabled(), 'isEnabled true after enable, twice')
  const body = fs.readFileSync(plist, 'utf8')
  t.ok(body.includes('<key>RunAtLoad</key><true/>'), 'plist runs the app at login')
  t.ok(body.includes(`<string>${marker}</string>`), 'plist carries the program arguments')
  await new Promise((resolve) => setTimeout(resolve, 800))
  t.absent(fs.existsSync(marker), 'enable did not start a second copy now')
  t.absent(await loaded(label), 'enable did not load the job into launchd')

  await li.disable()
  await li.disable()
  t.absent(await li.isEnabled(), 'isEnabled false after disable, twice')
  t.absent(fs.existsSync(plist), 'plist removed')
})

test('enable() rejects when programArguments is empty', async (t) => {
  const li = createLoginItem({ dir: await tmp(t), label: 'com.pearwallpaper.test.empty.' + process.pid, programArguments: [] })
  await t.exception(() => li.enable())
})
