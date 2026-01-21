// Mock for electron-store module
// Provides in-memory storage for testing without file system access

const Store = jest.fn(function(options) {
  const instance = {
    data: {},
    defaults: options?.defaults || {},
    
    get: jest.fn((key, defaultValue) => {
      if (key === undefined) {
        return instance.data;
      }
      return instance.data[key] !== undefined ? instance.data[key] : (defaultValue !== undefined ? defaultValue : instance.defaults[key]);
    }),
    
    set: jest.fn((key, value) => {
      instance.data[key] = value;
    }),
    
    delete: jest.fn((key) => {
      delete instance.data[key];
    }),
    
    clear: jest.fn(() => {
      instance.data = {};
    }),
    
    has: jest.fn((key) => {
      return key in instance.data;
    }),
    
    reset: jest.fn((...keys) => {
      if (keys.length === 0) {
        instance.data = { ...instance.defaults };
      } else {
        keys.forEach(key => {
          if (instance.defaults[key] !== undefined) {
            instance.data[key] = instance.defaults[key];
          } else {
            delete instance.data[key];
          }
        });
      }
    }),
    
    get size() {
      return Object.keys(instance.data).length;
    },
    
    get path() {
      return '/mock/electron-store/config.json';
    }
  };
  
  // Initialize with defaults
  if (options?.defaults) {
    instance.data = JSON.parse(JSON.stringify(options.defaults));
  }
  
  return instance;
});

module.exports = Store;
