// Ops are plain JSON. Binary keys travel as hex strings.
// `apply` must stay deterministic, so anything time- or random-based
// (sentAt, send ids) is stamped HERE, at append time on the writer.
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

module.exports = {
  addDevice({ key, swarmKey, name, isCreator = false }) {
    return { type: 'add-device', key, swarmKey, name, isCreator }
  },
  removeDevice({ key }) {
    return { type: 'remove-device', key }
  },
  addInvite({ id, invite, publicKey, expires }) {
    return { type: 'add-invite', id, invite, publicKey, expires }
  },
  delInvite() {
    return { type: 'del-invite' }
  },
  setWallpaper({ from, targets, blob, meta }) {
    return {
      type: 'set-wallpaper',
      id: b4a.toString(crypto.randomBytes(16), 'hex'),
      from,
      targets,
      blob, // { core: hex, id: hyperblobs id object }
      meta, // { filename, byteLength }
      sentAt: Date.now()
    }
  },
  applied({ sendId, device }) {
    return { type: 'applied', sendId, device, appliedAt: Date.now() }
  }
}
