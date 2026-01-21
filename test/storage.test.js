// Jest unit tests for app/shared/storage.js
// Tests data persistence, history management, settings, and deduplication

jest.mock('electron-store');
jest.mock('crypto');

const Store = require('electron-store');
const StorageManager = require('../app/shared/storage');

describe('StorageManager', () => {
  let storageManager;
  let mockStore;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up a consistent mock store instance
    mockStore = {
      data: {},
      get: jest.fn((key, defaultValue) => {
        if (key === undefined) return mockStore.data;
        return mockStore.data[key] !== undefined ? mockStore.data[key] : defaultValue;
      }),
      set: jest.fn((key, value) => {
        mockStore.data[key] = value;
      }),
      delete: jest.fn((key) => {
        delete mockStore.data[key];
      }),
      clear: jest.fn(() => {
        mockStore.data = {};
      }),
      has: jest.fn((key) => key in mockStore.data),
      path: '/mock/path/config.json'
    };
    
    // Make Store constructor return our mock
    Store.mockImplementation(() => mockStore);
    
    // Create storage manager
    storageManager = new StorageManager();
  });

  describe('constructor', () => {
    it('should initialize with electron-store', () => {
      expect(Store).toHaveBeenCalledWith({
        name: 'clyp-data',
        defaults: expect.objectContaining({
          history: [],
          settings: expect.any(Object)
        })
      });
    });

    it('should set default settings', () => {
      const defaults = Store.mock.calls[0][0].defaults;
      expect(defaults.settings).toMatchObject({
        maxHistorySize: 100,
        monitoringEnabled: true,
        captureText: true,
        captureRichText: true,
        captureImages: true,
        captureFiles: false,
        startOnBoot: false,
        autoDeleteHistory: false,
        deletePinnedItems: false
      });
    });
  });

  describe('getHistory', () => {
    it('should return empty array for new storage', () => {
      mockStore.get.mockReturnValue([]);
      const history = storageManager.getHistory();
      expect(history).toEqual([]);
    });

    it('should return stored history items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', timestamp: Date.now() },
        { id: '2', type: 'text', content: 'test2', timestamp: Date.now() }
      ];
      mockStore.get.mockReturnValue(items);
      
      const history = storageManager.getHistory();
      expect(history).toEqual(items);
    });

    it('should filter out invalid items', () => {
      const items = [
        { id: '1', type: 'text', content: 'valid', timestamp: Date.now() },
        { invalid: 'item' }, // Missing required fields
        null,
        { id: '2', type: 'text', content: 'valid2', timestamp: Date.now() }
      ];
      mockStore.get.mockReturnValue(items);
      
      const history = storageManager.getHistory();
      expect(history).toHaveLength(2);
      expect(mockStore.set).toHaveBeenCalledWith('history', expect.arrayContaining([
        expect.objectContaining({ content: 'valid' }),
        expect.objectContaining({ content: 'valid2' })
      ]));
    });

    it('should reset history if not an array', () => {
      mockStore.get.mockReturnValue('invalid');
      
      const history = storageManager.getHistory();
      expect(history).toEqual([]);
      expect(mockStore.set).toHaveBeenCalledWith('history', []);
    });

    it('should handle errors gracefully', () => {
      mockStore.get.mockImplementation(() => {
        throw new Error('Storage error');
      });
      
      const history = storageManager.getHistory();
      expect(history).toEqual([]);
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      mockStore.get.mockReturnValue([]);
    });

    it('should add valid item to history', () => {
      const item = {
        id: '1',
        type: 'text',
        content: 'test content',
        timestamp: Date.now()
      };
      
      const result = storageManager.addItem(item);
      
      expect(result).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([expect.objectContaining({ content: 'test content' })])
      );
    });

    it('should reject invalid items', () => {
      const invalidItems = [
        null,
        {},
        { type: 'text' }, // Missing content
        { content: 'test' }, // Missing type
      ];
      
      invalidItems.forEach(item => {
        expect(storageManager.addItem(item)).toBe(false);
      });
    });

    it('should detect duplicate content', () => {
      const item1 = { id: '1', type: 'text', content: 'test', timestamp: Date.now() };
      const item2 = { id: '2', type: 'text', content: 'test', timestamp: Date.now() };
      
      storageManager.addItem(item1);
      mockStore.get.mockReturnValue([item1]);
      
      const result = storageManager.addItem(item2);
      expect(result).toBe(false);
    });

    it('should respect maxHistorySize setting', () => {
      const settings = { maxHistorySize: 2 };
      mockStore.get.mockImplementation((key) => {
        if (key === 'settings') return settings;
        if (key === 'history') return [
          { id: '1', type: 'text', content: 'old1', timestamp: 1 },
          { id: '2', type: 'text', content: 'old2', timestamp: 2 }
        ];
        return [];
      });
      
      const newItem = { id: '3', type: 'text', content: 'new', timestamp: 3 };
      storageManager.addItem(newItem);
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([
          expect.objectContaining({ content: 'new' }),
          expect.objectContaining({ content: 'old1' })
        ])
      );
      expect(mockStore.set.mock.calls[0][1]).toHaveLength(2);
    });

    it('should preserve pinned items when trimming history', () => {
      const settings = { maxHistorySize: 2 };
      mockStore.get.mockImplementation((key) => {
        if (key === 'settings') return settings;
        if (key === 'history') return [
          { id: '1', type: 'text', content: 'pinned', timestamp: 1, pinned: true },
          { id: '2', type: 'text', content: 'old', timestamp: 2 }
        ];
        return [];
      });
      
      const newItem = { id: '3', type: 'text', content: 'new', timestamp: 3 };
      storageManager.addItem(newItem);
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([
          expect.objectContaining({ content: 'pinned', pinned: true }),
          expect.objectContaining({ content: 'new' })
        ])
      );
    });
  });

  describe('deleteItem', () => {
    it('should delete non-pinned items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test1', pinned: false },
        { id: '2', type: 'text', content: 'test2', pinned: false }
      ];
      mockStore.get.mockReturnValue(items);
      
      const result = storageManager.deleteItem('1');
      
      expect(result).toHaveLength(1);
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([expect.objectContaining({ id: '2' })])
      );
    });

    it('should prevent deletion of pinned items', () => {
      const items = [
        { id: '1', type: 'text', content: 'pinned', pinned: true },
        { id: '2', type: 'text', content: 'normal', pinned: false }
      ];
      mockStore.get.mockReturnValue(items);
      
      const result = storageManager.deleteItem('1');
      
      expect(result).toHaveLength(2);
      expect(mockStore.set).not.toHaveBeenCalled();
    });
  });

  describe('togglePin', () => {
    it('should pin unpinned items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', pinned: false }
      ];
      mockStore.get.mockReturnValue(items);
      
      storageManager.togglePin('1');
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([expect.objectContaining({ id: '1', pinned: true })])
      );
    });

    it('should unpin pinned items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', pinned: true }
      ];
      mockStore.get.mockReturnValue(items);
      
      storageManager.togglePin('1');
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([expect.objectContaining({ id: '1', pinned: false })])
      );
    });
  });

  describe('clearHistory', () => {
    it('should clear all items when deletePinnedItems is true', () => {
      const settings = { deletePinnedItems: true };
      const items = [
        { id: '1', type: 'text', content: 'test1', pinned: false },
        { id: '2', type: 'text', content: 'test2', pinned: true }
      ];
      mockStore.get.mockImplementation((key) => {
        if (key === 'settings') return settings;
        if (key === 'history') return items;
        return [];
      });
      
      const result = storageManager.clearHistory();
      
      expect(result).toEqual([]);
      expect(mockStore.set).toHaveBeenCalledWith('history', []);
    });

    it('should preserve pinned items by default', () => {
      const settings = { deletePinnedItems: false };
      const items = [
        { id: '1', type: 'text', content: 'normal', pinned: false },
        { id: '2', type: 'text', content: 'pinned', pinned: true }
      ];
      mockStore.get.mockImplementation((key) => {
        if (key === 'settings') return settings;
        if (key === 'history') return items;
        return [];
      });
      
      const result = storageManager.clearHistory();
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ content: 'pinned', pinned: true });
    });
  });

  describe('getSettings', () => {
    it('should return current settings', () => {
      const settings = { maxHistorySize: 100, monitoringEnabled: true };
      mockStore.get.mockReturnValue(settings);
      
      const result = storageManager.getSettings();
      
      expect(result).toEqual(settings);
      expect(mockStore.get).toHaveBeenCalledWith('settings');
    });
  });

  describe('updateSettings', () => {
    it('should merge new settings with existing', () => {
      const existing = { maxHistorySize: 100, monitoringEnabled: true };
      const updates = { maxHistorySize: 200 };
      
      mockStore.get.mockReturnValue(existing);
      
      const result = storageManager.updateSettings(updates);
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({
          maxHistorySize: 200,
          monitoringEnabled: true
        })
      );
    });
  });

  describe('tag management', () => {
    it('should add tags to items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', tags: [] }
      ];
      mockStore.get.mockReturnValue(items);
      
      storageManager.addTagToItem('1', 'important');
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([
          expect.objectContaining({ id: '1', tags: ['important'] })
        ])
      );
    });

    it('should not add duplicate tags', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', tags: ['existing'] }
      ];
      mockStore.get.mockReturnValue(items);
      
      const result = storageManager.addTagToItem('1', 'existing');
      
      // Should not call set when tag already exists
      expect(mockStore.set).not.toHaveBeenCalled();
      // Result should still contain the item with existing tag
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tags: ['existing'] })
        ])
      );
    });

    it('should remove tags from items', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', tags: ['tag1', 'tag2'] }
      ];
      mockStore.get.mockReturnValue(items);
      
      storageManager.removeTagFromItem('1', 'tag1');
      
      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.arrayContaining([
          expect.objectContaining({ tags: ['tag2'] })
        ])
      );
    });
  });

  describe('removeDuplicates', () => {
    it('should remove duplicate items based on content hash', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', timestamp: 1 },
        { id: '2', type: 'text', content: 'test', timestamp: 2 },
        { id: '3', type: 'text', content: 'unique', timestamp: 3 }
      ];
      mockStore.get.mockReturnValue(items);
      
      const result = storageManager.removeDuplicates();
      
      expect(result.length).toBeLessThan(items.length);
      expect(mockStore.set).toHaveBeenCalled();
    });

    it('should preserve the first occurrence of duplicates', () => {
      const items = [
        { id: '1', type: 'text', content: 'test', timestamp: 1 },
        { id: '2', type: 'text', content: 'test', timestamp: 2 }
      ];
      mockStore.get.mockReturnValue(items);
      
      const result = storageManager.removeDuplicates();
      
      // Should keep first occurrence (id '1')
      expect(result).toHaveLength(1);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: '1', timestamp: 1 })
        ])
      );
    });
  });

  describe('clearAllData', () => {
    it('should clear all storage data', () => {
      storageManager.clearAllData();
      
      expect(mockStore.clear).toHaveBeenCalled();
    });
  });

  describe('getStorePath', () => {
    it('should return store path', () => {
      mockStore.path = '/mock/path/config.json';
      
      const path = storageManager.getStorePath();
      
      expect(path).toBe('/mock/path/config.json');
    });
  });
});
