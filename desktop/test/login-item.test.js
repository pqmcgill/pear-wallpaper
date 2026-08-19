const test = require('brittle')
const fs = require('fs')
const path = require('path')
const os = require('os')
const tmp = require('test-tmp')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileP = promisify(execFile)
const { createLoginItem } = require('../lib/login-item.js')

test('enable writes a LaunchAgent that RunAtLoad-fires, isEnabled reflects it, disable removes it', async (t) => {
  const dir = await tmp(t)
  const marker = path.join(dir, 'ran.txt')
  const label = 'com.pearwallpaper.test.' + process.pid
  const li = createLoginItem({
    dir,
    label,
    programArguments: ['/usr/bin/touch', marker],
    exec: (cmd, args) => execFileP(cmd, args)
  })
  t.absent(await li.isEnabled(), 'not enabled initially')
  await li.enable()
  await new Promise((r) => setTimeout(r, 800)) // let launchd RunAtLoad fire
  t.ok(fs.existsSync(marker), 'RunAtLoad executed the program')
  t.ok(await li.isEnabled(), 'isEnabled true after enable')
  t.ok(fs.existsSync(path.join(dir, label + '.plist')), 'plist written')
  await li.disable()
  t.absent(await li.isEnabled(), 'isEnabled false after disable')
  t.absent(fs.existsSync(path.join(dir, label + '.plist')), 'plist removed')
})
