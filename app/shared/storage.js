const Store = require('electron-store');
const crypto = require('crypto');

class StorageManager {
  constructor() {
    this.store = new Store({
      name: 'clyp-data',
      defaults: {
        history: [],
        settings: {
          maxHistorySize: 100,
          monitoringEnabled: true,
          captureText: true,
          captureRichText: true,
          captureImages: true,
          captureFiles: false,
          startOnBoot: false,
          theme: 'spring-glass',
          shortcut: process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V',
          autoDeleteHistory: false,
          autoDeleteDays: 30,
          deletePinnedItems: false,
          hideDockIcon: false,
          developerTools: false
        }
      }
    });
  }

  /**
   * Get clipboard history
   */
  getHistory() {
    try {
      const history = this.store.get('history', []);
      
      // Validate that history is an array
      if (!Array.isArray(history)) {
        console.error('History is not an array, resetting');
        this.store.set('history', []);
        return [];
      }
      
      // Filter out any invalid items
      const validHistory = history.filter(item => {
        return item && typeof item === 'object' && item.content && item.type;
      });
      
      // If we filtered out items, save the cleaned version
      if (validHistory.length !== history.length) {
        console.warn(`Filtered out ${history.length - validHistory.length} invalid item(s)`);
        this.store.set('history', validHistory);
      }
      
      return validHistory;
    } catch (error) {
      console.error('Error reading history:', error);
      return [];
    }
  }

  /**
   * Generate content hash for deduplication
   */
  generateContentHash(content, type) {
    const normalized = String(content).trim();
    return crypto.createHash('sha256').update(`${type}:${normalized}`).digest('hex');
  }

  /**
   * Add item to history
   */
  addItem(item) {
    try {
      let history = this.getHistory();
      const settings = this.getSettings();
      
      // Validate item
      if (!item || !item.content || !item.type) {
        console.warn('Invalid item, skipping:', item);
        return false;
      }
      
      // Generate content hash for this item
      const contentHash = this.generateContentHash(item.content, item.type);
      
      // Check for duplicates using multiple methods
      const isDuplicate = history.some(existingItem => {
        // Direct content comparison
        if (existingItem.content === item.content && existingItem.type === item.type) {
          return true;
        }
        // Hash comparison for normalized content
        const existingHash = this.generateContentHash(existingItem.content, existingItem.type);
        return existingHash === contentHash;
      });
      
      if (isDuplicate) {
        console.log('Duplicate item detected, skipping');
        return false;
      }
      
      // Add content hash to item for future comparisons
      item.contentHash = contentHash;
      
      // Add to beginning of array
      history.unshift(item);
      
      // Enforce max history size (keep pinned items)
      const maxSize = settings.maxHistorySize || 100;
      const pinnedItems = history.filter(item => item.pinned);
      const unpinnedItems = history.filter(item => !item.pinned);
      
      if (unpinnedItems.length > maxSize) {
        unpinnedItems.length = maxSize;
      }
      
      history = [...pinnedItems, ...unpinnedItems];
      
      // Auto-delete old items if enabled
      if (settings.autoDeleteHistory && settings.autoDeleteDays) {
        const cutoffDate = Date.now() - (settings.autoDeleteDays * 24 * 60 * 60 * 1000);
        history = history.filter(item => 
          item.pinned || item.timestamp > cutoffDate
        );
      }
      
      // Final validation before saving
      if (!Array.isArray(history)) {
        console.error('History is not an array, resetting');
        history = [item];
      }
      
      this.store.set('history', history);
      return true; // Item was added
    } catch (error) {
      console.error('Error adding item to history:', error);
      return false;
    }
  }

  /**
   * Delete item from history (pinned items cannot be deleted)
   */
  deleteItem(id) {
    let history = this.getHistory();
    const itemToDelete = history.find(item => item.id === id);
    
    // Prevent deletion of pinned items
    if (itemToDelete && itemToDelete.pinned) {
      console.warn('Cannot delete pinned item. Unpin it first.');
      return history;
    }
    
    history = history.filter(item => item.id !== id);
    this.store.set('history', history);
    return history;
  }

  /**
   * Toggle pin status of item
   */
  togglePin(id) {
    let history = this.getHistory();
    const item = history.find(item => item.id === id);
    if (item) {
      item.pinned = !item.pinned;
      this.store.set('history', history);
    }
    return history;
  }

  /**
   * Clear all history
   */
  clearHistory() {
    const settings = this.getSettings();
    const history = this.getHistory();
    
    if (settings.deletePinnedItems) {
      // Delete all items including pinned ones
      this.store.set('history', []);
      return [];
    } else {
      // Keep pinned items (default behavior)
      const pinnedItems = history.filter(item => item.pinned);
      this.store.set('history', pinnedItems);
      return pinnedItems;
    }
  }

  /**
   * Get settings
   */
  getSettings() {
    return this.store.get('settings');
  }

  /**
   * Update settings
   */
  updateSettings(newSettings) {
    const currentSettings = this.getSettings();
    const merged = { ...currentSettings, ...newSettings };

    // Normalize shortcut token to a predictable canonical form when present
    if (merged.shortcut && typeof merged.shortcut === 'string') {
      const normalize = (accel) => {
        return accel.split('+').map(p => p.trim()).filter(Boolean).map(token => {
          const t = token.toLowerCase();
          if (t === 'cmd' || t === 'command' || t === 'ctrl' || t === 'control') return 'CommandOrControl';
          if (t === 'cmdorcontrol' || t === 'commandorcontrol') return 'CommandOrControl';
          if (t === 'alt' || t === 'option') return 'Alt';
          if (t === 'shift') return 'Shift';
          if (/^f\d{1,2}$/i.test(t)) return token.toUpperCase();
          if (t.length === 1) return token.toUpperCase();
          return token;
        }).join('+');
      };

      try {
        merged.shortcut = normalize(merged.shortcut);
      } catch (e) {
        // leave as-is on error
      }
    }

    this.store.set('settings', merged);
    return merged;
  }

  /**
   * Reset settings to defaults
   */
  resetSettings() {
    const defaults = this.store.defaults.settings;
    this.store.set('settings', defaults);
    return defaults;
  }

  /**
   * Add tag to item
   */
  addTagToItem(id, tag) {
    let history = this.getHistory();
    const item = history.find(item => item.id === id);
    if (item) {
      if (!item.tags) item.tags = [];
      if (!item.tags.includes(tag)) {
        item.tags.push(tag);
        this.store.set('history', history);
      }
    }
    return history;
  }

  /**
   * Remove tag from item
   */
  removeTagFromItem(id, tag) {
    let history = this.getHistory();
    const item = history.find(item => item.id === id);
    if (item && item.tags) {
      item.tags = item.tags.filter(t => t !== tag);
      this.store.set('history', history);
    }
    return history;
  }

  /**
   * Get all unique tags
   */
  getAllTags() {
    const history = this.getHistory();
    const allTags = new Set();
    history.forEach(item => {
      if (item.tags) {
        item.tags.forEach(tag => allTags.add(tag));
      }
    });
    return Array.from(allTags).sort();
  }

  /**
   * Remove duplicate items from history
   */
  removeDuplicates() {
    try {
      let history = this.getHistory();
      const seen = new Set();
      const uniqueHistory = [];
      
      for (const item of history) {
        if (!item || !item.content || !item.type) {
          console.warn('Skipping invalid item during deduplication');
          continue;
        }
        
        // Use hash-based deduplication
        const hash = this.generateContentHash(item.content, item.type);
        
        if (!seen.has(hash)) {
          seen.add(hash);
          // Add hash to item if not present
          if (!item.contentHash) {
            item.contentHash = hash;
          }
          uniqueHistory.push(item);
        } else {
          console.log('Removed duplicate item:', item.preview || 'no preview');
        }
      }
      
      console.log(`Removed ${history.length - uniqueHistory.length} duplicate(s)`);
      this.store.set('history', uniqueHistory);
      return uniqueHistory;
    } catch (error) {
      console.error('Error removing duplicates:', error);
      return this.getHistory();
    }
  }

  /**
   * Get store path (for debugging)
   */
  getStorePath() {
    return this.store.path;
  }
}

module.exports = StorageManager;
