const test = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')
const { makeTestnet, tmpDir } = require('./helpers')

test('two swarms exchange a hypercore block over a local testnet', async function (t) {
  const tn = await makeTestnet(t)

  const storeA = new Corestore(await tmpDir(t))
  const storeB = new Corestore(await tmpDir(t))

  const coreA = storeA.get({ name: 'demo' })
  await coreA.ready()
  await coreA.append(b4a.from('hello p2p'))

  const swarmA = new Hyperswarm({ bootstrap: tn.bootstrap })
  const swarmB = new Hyperswarm({ bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await swarmA.destroy()
    await swarmB.destroy()
    await storeA.close()
    await storeB.close()
  })

  swarmA.on('connection', (conn) => storeA.replicate(conn))
  swarmB.on('connection', (conn) => storeB.replicate(conn))

  const discovery = swarmA.join(coreA.discoveryKey)
  await discovery.flushed() // A's announce must reach the DHT before B looks up
  swarmB.join(coreA.discoveryKey)

  const coreB = storeB.get(coreA.key) // capability: knowing the key IS the read grant
  await coreB.ready()
  const block = await coreB.get(0)
  t.is(b4a.toString(block), 'hello p2p')
})
