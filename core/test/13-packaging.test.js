const test = require('brittle')
const pkg = require('../package.json')

// C4 regression. package.json's imports map rewrites fs -> bare-fs and
// path -> bare-path under Bare, and index.js requires both at load. Both
// shells run Bare, so installing this package pulls only `dependencies`:
// with bare-fs/bare-path in devDependencies, require('fs') fails at load
// in every consumer. Every Holepunch library declares them as runtime deps.
test('packaging: the Bare imports-map targets are runtime dependencies', function (t) {
  for (const name of Object.keys(pkg.imports)) {
    const target = pkg.imports[name].bare
    t.ok(pkg.dependencies[target], `${target} (imports["${name}"].bare) is a dependency`)
    t.absent(pkg.devDependencies[target], `${target} is not dev-only`)
  }
})

// NOTE for whoever touches this next: blind-pairing@2.3.1 `require`s
// compact-encoding (and protomux) without declaring either, and our own
// declared ^2.x was silently satisfying that via hoisting. Dropping it
// needed a clean re-resolve (rm -rf node_modules package-lock.json &&
// npm install) so npm hoists the 3.3.1 every other package agrees on;
// an incremental install just deletes the hoisted copy and blind-pairing
// stops loading. That every test file here loads index.js -> blind-pairing
// is the standing proof the require still resolves.
test('packaging: no unused dependencies are declared', function (t) {
  t.absent(pkg.dependencies['compact-encoding'], 'compact-encoding has zero uses in this package')
})
