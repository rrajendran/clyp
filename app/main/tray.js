const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const EventEmitter = require('events');

class TrayManager extends EventEmitter {
  constructor(storageManager) {
    super();
    this.storageManager = storageManager;
    this.tray = null;
    this.monitoringEnabled = true;
    this.init();
  }

  /**
   * Initialize system tray
   */
  init() {
    try {
      // Create tray icon
      const iconPath = this.getTrayIcon();
      let icon;
      
      // Try to load icon from file
      if (require('fs').existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
      }
      
      // If icon is empty or doesn't exist, create a simple one
      if (!icon || icon.isEmpty()) {
        console.warn('Tray icon not found, using fallback');
        icon = this.createFallbackIcon();
      }
      
      // Resize icon for tray (16x16 for macOS, 16x16 for Windows/Linux)
      const resizedIcon = icon.resize({ width: 16, height: 16 });
      
      this.tray = new Tray(resizedIcon);
      this.tray.setToolTip('Clyp - Clipboard Manager');
      
      // Build and set context menu
      this.updateMenu();
      
      // Handle tray click: show context menu only (do not open main window)
      this.tray.on('click', () => {
        if (this.tray) {
          this.tray.popUpContextMenu();
        }
      });
    } catch (error) {
      console.error('Failed to initialize tray:', error);
      // Try with fallback icon
      try {
        const icon = this.createFallbackIcon();
        this.tray = new Tray(icon);
        this.tray.setToolTip('Clyp - Clipboard Manager');
        this.updateMenu();
      } catch (fallbackError) {
        console.error('Failed to create tray with fallback:', fallbackError);
      }
    }
  }

  /**
   * Create a fallback icon if the icon files don't exist
   */
  createFallbackIcon() {
    // Create a simple 16x16 PNG from base64 data
    // This is a black 16x16 square that works for tray icons
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNkYGD4z4AEjAIAKpwBAQqCK3QAAAAASUVORK5CYII=',
      'base64'
    );
    
    return nativeImage.createFromBuffer(pngData);
  }

  /**
   * Get appropriate tray icon based on platform and theme
   */
  getTrayIcon() {
    const platform = process.platform;
    const iconsDir = path.join(__dirname, '../../assets/icons/png');
    // Use PNG variants that exist; we'll resize to tray size after load
    if (platform === 'darwin') {
      return path.join(iconsDir, '32x32.png');
    } else if (platform === 'win32') {
      return path.join(iconsDir, '32x32.png');
    } else {
      return path.join(iconsDir, '32x32.png');
    }
  }

  /**
   * Update tray context menu
   */
  updateMenu() {
    if (!this.tray) return;
    const settings = this.storageManager.getSettings();
    this.monitoringEnabled = settings.monitoringEnabled !== false;
    const developerToolsEnabled = settings.developerTools === true;

    const menuTemplate = [
      {
        label: 'Open Clipboard History',
        click: () => this.emit('show-history')
      },
      {
        type: 'separator'
      },
      {
        label: 'Settings',
        accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,',
        click: () => this.emit('show-settings')
      },
      {
        type: 'separator'
      },
      {
        label: this.monitoringEnabled ? 'Pause Monitoring' : 'Resume Monitoring',
        click: () => {
          this.monitoringEnabled = !this.monitoringEnabled;
          this.storageManager.updateSettings({ monitoringEnabled: this.monitoringEnabled });
          this.emit('toggle-monitoring', this.monitoringEnabled);
          this.updateMenu();
        }
      },
      {
        label: 'Clear History',
        click: () => {
          this.emit('clear-history');
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'About',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            enabled: developerToolsEnabled,
            click: () => {
              this.emit('toggle-dev-tools');
            }
          },
          {
            type: 'separator'
          },
          {
            label: `Version ${app.getVersion()}`,
            enabled: false
          }
        ]
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit Clyp',
        click: () => this.emit('quit')
      }
    ];

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Destroy tray icon
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
//
