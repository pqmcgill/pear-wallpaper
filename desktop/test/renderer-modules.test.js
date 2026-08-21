'use strict'
// Guards the renderer's module graph for a no-bundler world.
//
// main.js loads ui/index.html with win.loadFile() — a plain file:// page.
// There is no bundler in that path (Pear's used to resolve everything), so:
//   (1) every bare specifier ('preact', 'htm', ...) MUST have an entry in
//       the inline <script type="importmap"> in ui/index.html, or the
//       browser throws "Failed to resolve module specifier" and the window
//       renders blank white;
//   (2) the page's CSP treats the inline import map as a script, so the
//       script-src directive must allowlist its exact sha256 — edit the map
//       text without regenerating the hash and Chromium silently drops the
//       map, which is the same blank window all over again. This test
//       recomputes the hash from the file so that drift fails CI, not the UI;
//   (3) everything the renderer imports must be browser ESM — a CommonJS
//       file (module.exports) throws "module is not defined" at runtime.
// Each assertion below exists because one of these failed silently once
// (the blank-white-screen bug after the Pear→Electron conversion).
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const uiDir = path.join(__dirname, '..', 'ui')
const indexHtml = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')

// All renderer module files: ui/*.js plus ui/components/*.js. If a new
// subdirectory of modules appears, add it here so its imports are guarded.
function rendererFiles () {
  const files = []
  for (const f of fs.readdirSync(uiDir)) {
    if (f.endsWith('.js')) files.push(path.join(uiDir, f))
  }
  const compDir = path.join(uiDir, 'components')
  for (const f of fs.readdirSync(compDir)) {
    if (f.endsWith('.js')) files.push(path.join(compDir, f))
  }
  return files
}

// Static import specifiers only (import ... from '...' / bare `import '...'`).
// Dynamic import() is deliberately out of scope — a regex can't see through
// computed arguments, and the renderer graph is fully static today.
function staticImportSpecifiers (source) {
  const re = /^import\s+(?:[\w${}\s,*]+?\s+from\s+)?['"]([^'"]+)['"]/gm
  const specs = []
  let m
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

// A specifier is "bare" when it names a package rather than a path — the
// browser can only resolve it through the import map.
function isBare (spec) {
  return !spec.startsWith('.') && !spec.startsWith('/')
}

// The exact raw text between the import-map tags — exactly what Chromium
// hashes for the CSP check, byte for byte, whitespace included. HTML
// comments are stripped first because commented-out markup is inert in the
// browser — without this, prose in a comment mentioning the script tag
// could shadow the real element.
function extractImportMapText () {
  const withoutComments = indexHtml.replace(/<!--[\s\S]*?-->/g, '')
  const m = withoutComments.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  return m ? m[1] : null
}

test('index.html has an inline import map covering every bare specifier', (t) => {
  const raw = extractImportMapText()
  t.ok(raw !== null, 'index.html contains an inline <script type="importmap">')
  if (raw === null) return // remaining assertions are meaningless without it
  const map = JSON.parse(raw)
  t.ok(map.imports && typeof map.imports === 'object', 'import map has an "imports" object')

  // Collect every bare specifier actually used across the renderer graph,
  // then require map coverage — so adding a new dependency to any ui file
  // without mapping it fails here instead of as a blank window.
  const bare = new Set()
  for (const file of rendererFiles()) {
    for (const spec of staticImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (isBare(spec)) bare.add(spec)
    }
  }
  t.ok(bare.size > 0, 'sanity: the renderer does use bare specifiers')
  for (const spec of bare) {
    t.ok(Object.hasOwn(map.imports, spec), `import map covers bare specifier "${spec}"`)
  }
})

test('every import-map target resolves to a real file', (t) => {
  const raw = extractImportMapText()
  t.ok(raw !== null, 'import map present')
  if (raw === null) return // remaining assertions are meaningless without it
  const map = JSON.parse(raw)
  // Targets are relative to the page URL (ui/index.html), so resolve them
  // against ui/. A stale target (package moved, node_modules pruned) would
  // 404 at runtime — the module graph fails and the window goes blank.
  for (const [spec, target] of Object.entries(map.imports)) {
    const resolved = path.resolve(uiDir, target)
    t.ok(fs.existsSync(resolved), `"${spec}" -> ${target} exists on disk`)
  }
})

test('every relative static import in the renderer resolves to a real file', (t) => {
  // Catches moves/renames going stale — e.g. the transport adapter moving
  // from lib/transport/ into ui/ (this bug's second half): any leftover
  // import of the old path fails right here.
  for (const file of rendererFiles()) {
    for (const spec of staticImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (isBare(spec)) continue
      const resolved = path.resolve(path.dirname(file), spec)
      t.ok(fs.existsSync(resolved), `${path.relative(uiDir, file)}: "${spec}" exists`)
    }
  }
})

test('CSP script-src allowlists self and the current import map hash', (t) => {
  const cspMatch = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)
  t.ok(cspMatch !== null, 'index.html has a CSP meta tag')
  if (cspMatch === null) return
  const directives = cspMatch[1].split(';').map((d) => d.trim())
  const scriptSrc = directives.find((d) => d.startsWith('script-src'))
  t.ok(scriptSrc !== undefined, 'CSP has an explicit script-src directive')
  if (scriptSrc === undefined) return
  // 'self' keeps ./app.js (an external same-origin script) loadable once
  // script-src stops falling back to default-src.
  t.ok(scriptSrc.includes("'self'"), "script-src includes 'self'")

  // The inline import map is a <script> element: script-src governs it, and
  // an inline script under a 'self'-only policy is blocked. The only inline
  // escape hatch that doesn't gut the CSP is a hash of the EXACT script
  // text. Recompute it from the file so that any edit to the map text that
  // forgets to regenerate the hash fails this test instead of shipping a
  // silently-dropped import map (=> blank window).
  const raw = extractImportMapText()
  t.ok(raw !== null, 'import map present')
  if (raw === null) return
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('base64')
  t.ok(scriptSrc.includes(`'sha256-${hash}'`), `script-src includes 'sha256-${hash}' (the hash of the current import map text)`)
})

test('the transport adapter the renderer imports is browser ESM, not CJS', (t) => {
  // The import map fixes specifier resolution, but a CommonJS module still
  // dies in the browser ("module is not defined") — there is no CJS/ESM
  // interop without a bundler. So the file app.js points its transport
  // import at must be genuine ESM.
  const appSrc = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf8')
  const transportSpec = staticImportSpecifiers(appSrc).find((s) => /electron-ipc/.test(s))
  t.ok(transportSpec !== undefined, 'app.js imports the electron-ipc transport adapter')
  const transportPath = path.resolve(uiDir, transportSpec)
  t.ok(fs.existsSync(transportPath), `transport adapter exists at ${transportSpec}`)
  const src = fs.readFileSync(transportPath, 'utf8')
  t.ok(/export function/.test(src), 'transport adapter uses an ESM export')
  t.ok(!/module\.exports/.test(src), 'transport adapter has no CommonJS module.exports')
})
