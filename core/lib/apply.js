const b4a = require('b4a')

// View keys. One module owns the key layout so scans stay consistent.
const k = {
  device: (hex) => `device/${hex}`,
  creator: 'creator',
  invite: 'invite',
  send: (id) => `send/${id}`,
  sendSeq: 'send-seq',
  ack: (sendId, deviceHex) => `ack/${sendId}/${deviceHex}`
}

// The apply function: consumes ordered log nodes, mutates the view.
// MUST be deterministic — every member runs this over the same op
// sequence and must land on byte-identical views.
//
// ROSTER POLICY (creator-only, enforced HERE): apply is the group's
// constitution — a compromised member can append any op it likes, but
// every honest peer's apply ignores roster ops not authored by the
// creator. The first add-device ever applied (createGroup's self-add)
// establishes the creator. `node.from.key` is the authoring writer's
// core key in autobase 7.x; if the pinned version names it differently,
// check the autobase source and log the divergence.
async function apply(nodes, view, base) {
  for (const node of nodes) {
    const op = node.value
    const author = b4a.toString(node.from.key, 'hex')
    switch (op.type) {
      case 'add-device': {
        const creator = await view.get(k.creator)
        if (creator === null) {
          // bootstrap: the very first add-device defines the creator —
          // bound to the VERIFIED author, never the op's claimed key
          if (op.key !== author) break
          await view.put(k.creator, { key: author })
        } else if (author !== creator.value.key) {
          break // forged roster op from a non-creator: ignored by every honest peer
        }
        const creatorKey = creator === null ? author : creator.value.key
        await view.put(k.device(op.key), {
          key: op.key,
          swarmKey: op.swarmKey,
          name: op.name,
          isCreator: op.key === creatorKey // derived, never self-reported
        })
        await base.addWriter(b4a.from(op.key, 'hex'))
        break
      }
      case 'remove-device': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only
        if (op.key === creator.value.key) break // the creator cannot be removed
        await view.del(k.device(op.key))
        await base.removeWriter(b4a.from(op.key, 'hex'))
        break
      }
      case 'add-invite': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only, like all authority ops
        await view.put(k.invite, {
          id: op.id, invite: op.invite, publicKey: op.publicKey, expires: op.expires
        })
        break
      }
      case 'del-invite': {
        const creator = await view.get(k.creator)
        if (creator === null || author !== creator.value.key) break // creator-only
        await view.del(k.invite)
        break
      }
      case 'set-wallpaper': {
        // AUTHOR BINDING: `from` drives the "who sent this" UI and
        // listReceived's fromKey, so it is the verified author or nothing.
        // Honest code always passes its own key (sendWallpaper does), so
        // legitimate sends are unaffected.
        if (op.from !== author) break
        const seqNode = await view.get(k.sendSeq)
        const seq = seqNode === null ? 1 : seqNode.value.n + 1
        await view.put(k.sendSeq, { n: seq })
        await view.put(k.send(op.id), {
          id: op.id, seq, from: op.from, targets: op.targets,
          blob: op.blob, meta: op.meta, sentAt: op.sentAt
        })
        break
      }
      case 'applied': {
        // AUTHOR BINDING: only a device may ack its OWN delivery. Unbound,
        // any member could forge a peer's ack — which permanently suppresses
        // that peer's delivery (_newestUnappliedForMe skips acked sends, so
        // the retry is dead, not delayed), shows the sender a false
        // delivered check, and injects a listReceived row whose filePath
        // never exists. markApplied always passes this.deviceKey, so honest
        // acks are unaffected.
        if (op.device !== author) break
        await view.put(k.ack(op.sendId, op.device), { appliedAt: op.appliedAt })
        break
      }
      // Unknown op types are skipped, not fatal: an older device must
      // survive ops appended by a newer one.
    }
  }
}

module.exports = { apply, k }
