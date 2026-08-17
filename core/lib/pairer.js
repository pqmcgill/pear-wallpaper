const Hyperswarm = require('hyperswarm')
const Autobase = require('autobase')
const z32 = require('z32')
const b4a = require('b4a')

// Runs the candidate side of blind-pairing on behalf of a WallpaperCore.
// Returns { candidate, promise, reject } immediately (before the pairing
// round-trip completes) so the caller can track/close/supersede the
// candidate while `promise` is still pending. `promise` resolves to
// { key, encryptionKey } (hex) once a member confirms us, or rejects with
// blind-pairing's coded error (PAIRING_REJECTED / INVITE_USED /
// INVITE_EXPIRED) if the member denies us, or with `reject`'s argument if
// the caller force-settles it (e.g. on close).
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

  let candidate = null
  let reject = null
  const promise = new Promise((resolve, rej) => {
    reject = rej
    candidate = core.pairing.addCandidate({
      invite: z32.decode(inviteZ32),
      userData,
      onadd: (result) => {
        resolve({
          key: b4a.toString(result.key, 'hex'),
          encryptionKey: b4a.toString(result.encryptionKey, 'hex')
        })
      }
    })
    // blind-pairing-core's CandidateRequest (candidate.request) emits
    // 'rejected' with a coded PairingError (PAIRING_REJECTED / INVITE_USED
    // / INVITE_EXPIRED) when the member responds with a non-zero status.
    // blind-pairing's own Candidate class swallows this internally
    // (handleResponse() catches it and just returns null, so _addResponse
    // treats it as "no match, keep polling") — it never surfaces on
    // `candidate` itself or on `onadd`. Listening on the underlying
    // request directly is the one observable surface for this.
    candidate.request.on('rejected', (err) => reject(err))
  })

  return { candidate, promise, reject }
}

module.exports = { requestJoin }
