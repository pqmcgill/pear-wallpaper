const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { pairedDuo, until, tmpDir } = require('../../helpers.js')
const { tinyPng } = require('./_util.js')

test('meta.filename: the sender\'s absolute local path replicates to every member', async function (t) {
  const { creator, joiner } = await pairedDuo(t)
  const dir = await tmpDir(t)
  const p = path.join(dir, 'Family Photos', 'patrick-beach-2026.png')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, tinyPng())
  const { id } = await creator.sendWallpaper(p, [joiner.deviceKey])
  await until(joiner, 'update', async () => (await joiner.base.view.get('send/' + id)) !== null)
  const meta = (await joiner.base.view.get('send/' + id)).value.meta
  t.comment('joiner sees meta = ' + JSON.stringify(meta))
  t.is(meta.filename, p)
})
