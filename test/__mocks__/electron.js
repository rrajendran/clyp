// Mock for Electron module
// Provides mock implementations for all Electron APIs used in the application

const mockBrowserWindow = {
  isMinimized: jest.fn(() => false),
  restore: jest.fn(),
  focus: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  close: jest.fn(),
  isDestroyed: jest.fn(() => false),
  webContents: {
    send: jest.fn(),
    openDevTools: jest.fn(),
    closeDevTools: jest.fn(),
    isDevToolsOpened: jest.fn(() => false),
    on: jest.fn()
  },
  on: jest.fn(),
  once: jest.fn(),
  loadFile: jest.fn(() => Promise.resolve()),
  setAlwaysOnTop: jest.fn(),
  center: jest.fn(),
  setVisibleOnAllWorkspaces: jest.fn(),
  setSkipTaskbar: jest.fn()
};

const mockApp = {
  getPath: jest.fn((name) => `/mock/path/${name}`),
  requestSingleInstanceLock: jest.fn(() => true),
  quit: jest.fn(),
  on: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve()),
  setLoginItemSettings: jest.fn(),
  getLoginItemSettings: jest.fn(() => ({ openAtLogin: false })),
  relaunch: jest.fn(),
  dock: {
    hide: jest.fn(),
    show: jest.fn()
  }
};

const mockTray = jest.fn(function() {
  return {
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn()
  };
});

const mockMenu = {
  buildFromTemplate: jest.fn((template) => ({ items: template })),
  setApplicationMenu: jest.fn()
};

const mockNativeImage = {
  createFromPath: jest.fn(() => ({
    isEmpty: jest.fn(() => false),
    resize: jest.fn(function() { return this; }),
    toPNG: jest.fn(() => Buffer.from('mock-png-data')),
    toDataURL: jest.fn(() => 'data:image/png;base64,mock'),
    getSize: jest.fn(() => ({ width: 100, height: 100 }))
  })),
  createFromBuffer: jest.fn(() => ({
    isEmpty: jest.fn(() => false),
    resize: jest.fn(function() { return this; })
  }))
};

const mockClipboard = {
  readText: jest.fn(() => ''),
  writeText: jest.fn(),
  readHTML: jest.fn(() => ''),
  readImage: jest.fn(() => mockNativeImage.createFromPath('mock')),
  availableFormats: jest.fn(() => [])
};

const mockPowerMonitor = {
  isOnBatteryPower: jest.fn(() => false),
  on: jest.fn(),
  removeListener: jest.fn()
};

const mockGlobalShortcut = {
  register: jest.fn(() => true),
  unregister: jest.fn(),
  unregisterAll: jest.fn(),
  isRegistered: jest.fn(() => false)
};

const mockIpcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn()
};

const mockShell = {
  openExternal: jest.fn(() => Promise.resolve())
};

module.exports = {
  app: mockApp,
  BrowserWindow: jest.fn(() => mockBrowserWindow),
  Tray: mockTray,
  Menu: mockMenu,
  nativeImage: mockNativeImage,
  clipboard: mockClipboard,
  powerMonitor: mockPowerMonitor,
  globalShortcut: mockGlobalShortcut,
  ipcMain: mockIpcMain,
  shell: mockShell
};
