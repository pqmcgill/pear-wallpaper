'use strict'
/* global Bare */
// Bare has no global `process` (it has `Bare` instead — see
// node_modules/bare-sidecar/lib/runtime.js). lib/platform/index.js reads
// Node's global `process.platform` directly (not via `require('process')`,
// so desktop/package.json's "imports" remap trick can't intercept it).
// Since `process` is a bare identifier, not a module specifier, the only
// place to supply it is a global polyfill, installed before that module
// is required. This file is side-effecting: requiring it installs the
// polyfill (a no-op if `process` already exists, e.g. under plain Node in
// tests).
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { platform: Bare.platform }
}
