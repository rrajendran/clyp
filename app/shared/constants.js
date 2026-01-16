const { app } = require('electron');
const path = require('path');

module.exports = {
  // App info
  APP_NAME: 'Clyp',
  APP_VERSION: '1.0.0',
  APP_ID: 'com.clyp.clipboard',
  
  // Branding
  BRANDING: {
    name: 'Clyp',
    tagline: 'Fast, Private, Cross-Platform Clipboard Manager',
    colors: {
      primary: '#4A90E2',
      secondary: '#50E3C2',
      background: '#F5F7FA',
      text: '#4A4A4A'
    }
  },
  
  // Paths
  PATHS: {
    userData: app.getPath('userData'),
    logs: path.join(app.getPath('userData'), 'logs'),
    temp: app.getPath('temp')
  },
  
  // Clipboard settings
  CLIPBOARD: {
    pollInterval: 500,
    maxHistorySize: 100,
    maxItemSizeBytes: 10 * 1024 * 1024, // 10MB
    supportedTypes: ['text', 'html', 'image', 'file']
  },
  
  // UI settings
  UI: {
    windowWidth: 600,
    windowHeight: 700,
    settingsWindowWidth: 800,
    settingsWindowHeight: 600
  },
  
  // Shortcuts
  SHORTCUTS: {
    default: {
      darwin: 'Command+Shift+V',
      win32: 'Control+Shift+V',
      linux: 'Control+Shift+V'
    }
  },
  
  // Performance
  PERFORMANCE: {
    startupTimeout: 500,
    maxMemoryMB: 150
  }
};
