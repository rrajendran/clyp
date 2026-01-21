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
    '!app/**/preload.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
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