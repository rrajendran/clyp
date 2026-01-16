const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Asset path
  getAssetPath: (assetPath) => ipcRenderer.invoke('get-asset-path', assetPath),
  // Platform info (provided synchronously from preload)
  getPlatform: () => process.platform,
  // History operations
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
  pinItem: (id) => ipcRenderer.invoke('pin-item', id),
  copyToClipboard: (content) => ipcRenderer.invoke('copy-to-clipboard', content),
  
  // Window operations
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showSettings: () => ipcRenderer.invoke('show-settings'),
  
  // Settings operations
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  clearAllData: () => ipcRenderer.invoke('clear-all-data'),
  removeDuplicates: () => ipcRenderer.invoke('remove-duplicates'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  setStartOnBoot: (enabled) => ipcRenderer.invoke('set-start-on-boot', enabled),
  
  // Tag operations
  addTagToItem: (id, tag) => ipcRenderer.invoke('add-tag-to-item', id, tag),
  removeTagFromItem: (id, tag) => ipcRenderer.invoke('remove-tag-from-item', id, tag),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  
  // External operations
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  
  // Event listeners
  onHistoryUpdated: (callback) => {
    ipcRenderer.on('history-updated', (event, history) => callback(history));
  }
});
