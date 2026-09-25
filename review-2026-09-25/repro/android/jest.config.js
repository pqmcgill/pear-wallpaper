const A = '/Users/patrick/code/pear-wallpaper/android'
module.exports = {
  preset: 'jest-expo',
  rootDir: A,
  roots: ['/private/tmp/claude-501/-Users-patrick-code-pear-wallpaper/fb557ea0-fc1e-445d-9da0-e42572bfdb8a/scratchpad/review/evidence/android'],
  testMatch: ['/private/tmp/claude-501/-Users-patrick-code-pear-wallpaper/fb557ea0-fc1e-445d-9da0-e42572bfdb8a/scratchpad/review/evidence/android/**/*.scratch.test.js'],
  moduleDirectories: ['node_modules', A + '/node_modules'],
  transform: {
    '\\.[jt]sx?$': ['babel-jest', { configFile: A + '/babel.config.js' }],
    '\\.mjs$': ['babel-jest', { configFile: A + '/babel.config.js' }]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|@paulmillr/qr))',
    '/node_modules/react-native-reanimated/plugin/'
  ]
}
