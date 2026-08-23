/* global BareKit, Bare */
'use strict'
const { createDuplexJsonTransport } = require('pear-wallpaper-bridge/transport')
const { createCoreHost } = require('./host.js')
createCoreHost({
  transport: createDuplexJsonTransport(BareKit.IPC),
  exit: () => Bare.exit()
})
