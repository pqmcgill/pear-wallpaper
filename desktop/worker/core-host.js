'use strict'
/* global Bare */
// Bare worker entry, spawned by pear-runtime's `PearRuntime.run()` (which,
// from a Node/Electron host, is bare-sidecar's `Sidecar` — a real OS
// subprocess running the bundled `bare` binary). bare-sidecar's own
// bootstrap (node_modules/bare-sidecar/lib/runtime.js) opens fd 3 as a
// `bare-pipe` Pipe and assigns it to the global `Bare.IPC` *before* loading
// this module, so `Bare.IPC` is this worker's side of the same duplex the
// host process gets back from `PearRuntime.run()`. See
// node_modules/bare-sidecar/README.md:28-32 for the documented contract
// (`Bare.IPC.on('data', ...)` / `Bare.IPC.write(...)`) and
// node_modules/bare-sidecar/lib/runtime.js:6-32 for exactly how/when it's
// set up. Echo-only for Task 2; real core wiring is Task 3.
const { createBareTransport } = require('../lib/transport/bare-ipc.js')

const endpoint = Bare.IPC
const transport = createBareTransport(endpoint)
transport.onMessage((msg) => {
  if (msg && msg.t === 'req') transport.send({ t: 'res', id: msg.id, ok: true, value: { echoedFromWorker: msg.cmd } })
})
