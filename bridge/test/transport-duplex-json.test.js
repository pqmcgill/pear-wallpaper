const test = require('brittle')
const { EventEmitter } = require('events')
const { createDuplexJsonTransport } = require('../transport/duplex-json.js')

function fakeEndpoint () {
  const ee = new EventEmitter()
  return Object.assign(ee, { written: [], write (b) { this.written.push(b.toString('utf8')) } })
}

test('duplex-json transport frames sends as newline-delimited JSON', (t) => {
  const ep = fakeEndpoint(); const tr = createDuplexJsonTransport(ep)
  tr.send({ t: 'req', id: 1, cmd: 'x' })
  t.is(ep.written[0], '{"t":"req","id":1,"cmd":"x"}\n')
})

test('duplex-json transport parses concatenated + split frames, drops malformed', (t) => {
  const ep = fakeEndpoint(); const tr = createDuplexJsonTransport(ep)
  const got = []; tr.onMessage((m) => got.push(m))
  ep.emit('data', Buffer.from('{"a":1}\n{"b":2}\n'))      // two in one chunk
  ep.emit('data', Buffer.from('{"c":'))                    // split frame...
  ep.emit('data', Buffer.from('3}\n'))                     // ...completed
  ep.emit('data', Buffer.from('not-json\n'))               // malformed → dropped
  t.alike(got, [{ a: 1 }, { b: 2 }, { c: 3 }])
})
