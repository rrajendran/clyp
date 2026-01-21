// Mock for Node.js crypto module
// Provides deterministic hashing for tests

const crypto = {
  createHash: jest.fn((algorithm) => {
    return {
      update: jest.fn(function(data) {
        this._data = data;
        return this;
      }),
      digest: jest.fn(function(encoding) {
        // Return deterministic hash based on input
        const hash = `mocked-${algorithm}-hash-${this._data?.substring(0, 10) || 'empty'}`;
        return encoding === 'hex' ? hash : Buffer.from(hash);
      })
    };
  })
};

module.exports = crypto;
