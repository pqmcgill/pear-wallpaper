const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const Autobase = require('autobase')
const z32 = require('z32')
const b4a = require('b4a')

// Runs the candidate side of blind-pairing on behalf of a WallpaperCore.
// Resolves { key, encryptionKey } (hex) once a member confirms us.
async function requestJoin(core, inviteZ32) {
  await core._startPairingSwarm() // swarm without a base yet (defined below in index.js)

  const local = Autobase.getLocalCore(core.store)
  await local.ready()
  const key = b4a.toString(local.key, 'hex')
  await local.close()

  const userData = b4a.from(JSON.stringify({
    key,
    swarmKey: await core._swarmKeyHex(),
    name: core.deviceName
  }))

  return new Promise((resolve, reject) => {
    const candidate = core.pairing.addCandidate({
      invite: z32.decode(inviteZ32),
      userData,
      onadd: (result) => {
        resolve({
          key: b4a.toString(result.key, 'hex'),
          encryptionKey: b4a.toString(result.encryptionKey, 'hex'),
          candidate
        })
      }
    })
  })
}

module.exports = { requestJoin }
