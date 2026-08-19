const test = require('brittle')
const { createDarwinPlatform } = require('../lib/platform/darwin.js')

test('setWallpaper invokes osascript with the path passed as an argv arg (no shell interpolation)', async (t) => {
  const calls = []
  const exec = async (cmd, args) => { calls.push({ cmd, args }); return { stdout: '', stderr: '' } }
  const p = createDarwinPlatform({ exec })
  await p.setWallpaper('/tmp/some image.png')
  t.is(calls.length, 1)
  t.is(calls[0].cmd, 'osascript')
  t.ok(calls[0].args.includes('--'), 'uses -- to separate the script from argv')
  t.is(calls[0].args[calls[0].args.length - 1], '/tmp/some image.png', 'path is the trailing argv item, unquoted')
  t.ok(calls[0].args.some((a) => a.includes('every desktop')), 'sets all desktops')
})

test('currentWallpaper returns the trimmed osascript stdout', async (t) => {
  const exec = async () => ({ stdout: '/Users/me/Pictures/wall.jpg\n', stderr: '' })
  const p = createDarwinPlatform({ exec })
  t.is(await p.currentWallpaper(), '/Users/me/Pictures/wall.jpg')
})
