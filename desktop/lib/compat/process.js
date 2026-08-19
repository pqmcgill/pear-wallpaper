'use strict'
/* global Bare */
// Bare has no global `process` (it has `Bare` instead — see
// node_modules/bare-sidecar/lib/runtime.js). Two reused, unmodified modules
// read Node's global `process` directly (not via `require('process')`, so
// desktop/package.json's "imports" remap trick can't intercept it):
//   - lib/platform/index.js: `process.platform`
//   - lib/login-item.js:      `process.getuid()`
// Since `process` is a bare identifier, not a module specifier, the only
// place to supply it is a global polyfill, installed before those modules
// are required. This file is side-effecting: requiring it installs the
// polyfill (a no-op if `process` already exists, e.g. under plain Node in
// tests).
if (typeof globalThis.process === 'undefined') {
  const os = require('os') // remapped to bare-os per package.json "imports"
  globalThis.process = {
    platform: Bare.platform,
    getuid () { return os.userInfo().uid }
  }
}
