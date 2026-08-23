module.exports = {
  preset: 'jest-expo',
  // test-worklet/ holds brittle tests (Task 3) that run the real Bare-side
  // core stack via `npm run test:worklet` — jest's default testMatch would
  // otherwise also pick up *.test.js there and fail (jest-expo's
  // babel-jest transform doesn't apply to code required by those tests,
  // e.g. ../core/index.js's plain `require`s).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test-worklet/']
}
