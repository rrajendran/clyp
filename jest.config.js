module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/test/**/*.test.js',
    '<rootDir>/test/**/*.spec.js'
  ],
  collectCoverageFrom: [
    'app/**/*.js',
    '!app/**/*.test.js',
    '!app/**/*.spec.js',
    '!app/renderer/**',
    '!app/**/preload.js',
    '!app/main/main.js',
    '!app/shared/constants.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.js'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/test/__mocks__/electron.js'
  },
  transform: {},
  transformIgnorePatterns: [
    'node_modules/(?!electron-store)'
  ],
  testTimeout: 10000
};