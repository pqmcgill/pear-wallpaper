module.exports = {
  preset: 'jest-expo',
  // test-worklet/ holds brittle tests (Task 3) that run the real Bare-side
  // core stack via `npm run test:worklet` — jest's default testMatch would
  // otherwise also pick up *.test.js there and fail (jest-expo's
  // babel-jest transform doesn't apply to code required by those tests,
  // e.g. ../core/index.js's plain `require`s).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test-worklet/'],
  // jest-expo's preset only wires babel-jest for `.jsx?`/`.tsx?` (its
  // transform regex is `\.[jt]sx?$`, which does not match `.mjs`). Task 4
  // imports two real ESM `.mjs` files that must run under jest as-is:
  // pear-wallpaper-bridge/ui (bridge-ui.mjs, plain `export function`) and
  // the bare-pack bundle output (app/gen/worklet.bundle.mjs, `export
  // default "..."`, mocked in tests). Both need the same babel-jest
  // transform the rest of the app gets. Jest merges preset + local
  // `transform` maps, so this adds a matcher rather than replacing the
  // preset's.
  transform: { '\\.mjs$': 'babel-jest' }
}
