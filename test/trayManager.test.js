// Jest unit tests for app/main/tray.js
// Tests system tray integration, menu management, and event handling

jest.mock('electron');

const { Tray, Menu, nativeImage, app } = require('electron');
const TrayManager = require('../app/main/tray');
const path = require('path');

describe('TrayManager', () => {
  let trayManager;
  let mockTrayInstance;
  let mockStorageManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock storage manager
    mockStorageManager = {
      getSettings: jest.fn(() => ({
        monitoringEnabled: true,
        developerTools: false
      })),
      updateSettings: jest.fn()
    };
    
    // Get the mocked tray instance
    mockTrayInstance = {
      setToolTip: jest.fn(),
      setContextMenu: jest.fn(),
      on: jest.fn(),
      destroy: jest.fn()
    };
    
    Tray.mockImplementation(() => mockTrayInstance);
    
    trayManager = new TrayManager(mockStorageManager);
  });

  afterEach(() => {
    if (trayManager) {
      trayManager.destroy();
    }
  });

  describe('constructor', () => {
    it('should create tray with icon', () => {
      expect(Tray).toHaveBeenCalledWith(
        expect.objectContaining({})
      );
    });

    it('should set tooltip', () => {
      expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('Clyp - Clipboard Manager');
    });

    it('should initialize with monitoring state from storage', () => {
      expect(mockStorageManager.getSettings).toHaveBeenCalled();
      expect(trayManager.monitoringEnabled).toBe(true);
    });

    it('should set up click handler', () => {
      expect(mockTrayInstance.on).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });

  describe('updateMenu', () => {
    it('should create menu with correct structure', () => {
      trayManager.updateMenu();
      
      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      
      expect(menuTemplate).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Open Clipboard History' }),
          expect.objectContaining({ label: 'Pause Monitoring' }),
          expect.objectContaining({ label: 'Clear History' })
        ])
      );
    });

    it('should show "Resume Monitoring" when monitoring is disabled', () => {
      mockStorageManager.getSettings.mockReturnValue({
        monitoringEnabled: false,
        developerTools: false
      });
      
      // Clear previous calls from constructor
      Menu.buildFromTemplate.mockClear();
      
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const monitoringItem = menuTemplate.find(item => 
        item.label === 'Resume Monitoring'
      );
      
      expect(monitoringItem).toBeDefined();
    });

    it('should enable developer tools menu when setting is true', () => {
      mockStorageManager.getSettings.mockReturnValue({
        monitoringEnabled: true,
        developerTools: true
      });
      
      // Clear previous calls from constructor
      Menu.buildFromTemplate.mockClear();
      
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const aboutItem = menuTemplate.find(item => item.label === 'About');
      const devToolsItem = aboutItem.submenu.find(item => 
        item.label === 'Toggle Developer Tools'
      );
      
      expect(devToolsItem.enabled).toBe(true);
    });

    it('should set context menu on tray', () => {
      trayManager.updateMenu();
      expect(mockTrayInstance.setContextMenu).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('should emit show-history event on click', () => {
      const clickHandler = mockTrayInstance.on.mock.calls.find(
        call => call[0] === 'click'
      )[1];
      
      const showListener = jest.fn();
      trayManager.on('show-history', showListener);
      
      clickHandler();
      
      expect(showListener).toHaveBeenCalled();
    });

    it('should emit show-settings when settings clicked', () => {
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const settingsItem = menuTemplate.find(item => item.label === 'Settings');
      
      const settingsListener = jest.fn();
      trayManager.on('show-settings', settingsListener);
      
      settingsItem.click();
      
      expect(settingsListener).toHaveBeenCalled();
    });

    it('should emit toggle-monitoring and update storage when monitoring toggled', () => {
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const monitoringItem = menuTemplate.find(item => 
        item.label === 'Pause Monitoring'
      );
      
      const monitoringListener = jest.fn();
      trayManager.on('toggle-monitoring', monitoringListener);
      
      monitoringItem.click();
      
      expect(mockStorageManager.updateSettings).toHaveBeenCalledWith({ monitoringEnabled: false });
      expect(monitoringListener).toHaveBeenCalledWith(false);
    });

    it('should emit clear-history when clear clicked', () => {
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const clearItem = menuTemplate.find(item => item.label === 'Clear History');
      
      const clearListener = jest.fn();
      trayManager.on('clear-history', clearListener);
      
      clearItem.click();
      
      expect(clearListener).toHaveBeenCalled();
    });

    it('should emit quit when quit clicked', () => {
      trayManager.updateMenu();
      
      const menuTemplate = Menu.buildFromTemplate.mock.calls[0][0];
      const quitItem = menuTemplate.find(item => item.label === 'Quit Clyp');
      
      const quitListener = jest.fn();
      trayManager.on('quit', quitListener);
      
      quitItem.click();
      
      expect(quitListener).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should destroy tray instance', () => {
      trayManager.destroy();
      expect(mockTrayInstance.destroy).toHaveBeenCalled();
    });

    it('should handle destroy when tray is null', () => {
      trayManager.tray = null;
      expect(() => trayManager.destroy()).not.toThrow();
    });
  });

  describe('monitoring state', () => {
    it('should update monitoring state from storage settings', () => {
      mockStorageManager.getSettings.mockReturnValue({
        monitoringEnabled: false,
        developerTools: false
      });
      
      trayManager.updateMenu();
      
      expect(trayManager.monitoringEnabled).toBe(false);
    });
  });

  describe('icon loading', () => {
    it('should handle icon load errors gracefully', () => {
      // Suppress console.error for this test since we're testing error handling
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      nativeImage.createFromPath.mockImplementation(() => {
        throw new Error('Icon not found');
      });
      
      const mockStorage = {
        getSettings: jest.fn(() => ({
          monitoringEnabled: true,
          developerTools: false
        })),
        updateSettings: jest.fn()
      };
      
      expect(() => new TrayManager(mockStorage)).not.toThrow();
      
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to initialize tray:', expect.any(Error));
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });
});