// Jest global setup file
// Configures test environment and global mocks

// Suppress console output during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Set default platform for tests
Object.defineProperty(process, 'platform', {
  value: 'darwin',
  writable: true
});

// Global test timeout
jest.setTimeout(10000);
