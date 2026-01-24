const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const TrayManager = require('./tray');
const ClipboardMonitor = require('./clipboardMonitor');
const StorageManager = require('../shared/storage');

let mainWindow = null;
let settingsWindow = null;
let trayManager = null;
let clipboardMonitor = null;
let storageManager = null;
let lastAppCopiedContent = null;
let lastAppCopyTimer = null;
// Detect development mode: explicit NODE_ENV=development or unpackaged app
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = console;

// Force dev update config for testing
if (isDev) {
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.updateConfigPath = path.join(__dirname, '../../dev-app-update.yml');
  // Allow unsigned builds in dev mode
  process.env.ELECTRON_UPDATER_ALLOW_DOWNGRADE = 'true';
}

// Set feed URL explicitly
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'rrajendran',
  repo: 'clyp'
});

// Auto-updater event listeners
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available. Current version:', info.version);
});

autoUpdater.on('error', (err) => {
  console.error('Update error:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download progress: ${Math.round(progressObj.percent)}%`);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
});

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      showMainWindow();
    }
  });
}

/**
 * Create the main clipboard history window
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../renderer/preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools automatically in development/unpacked runs
  if (isDev && mainWindow && mainWindow.webContents) {
    try {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (e) {
      // ignore if not available
    }
  }

  // Hide window when it loses focus
  mainWindow.on('blur', () => {
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Position window just below the tray/menu bar icon
  positionWindowBelowTray(mainWindow);

  return mainWindow;
}

/**
 * Create settings window
 */
function createSettingsWindow() {
  if (settingsWindow) {
    if (settingsWindow.isDestroyed()) {
      settingsWindow = null;
    } else {
      // Ensure only one window is visible
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      
      if (!settingsWindow.isVisible()) {
        positionWindowBelowTray(settingsWindow);
        settingsWindow.show();
      }
      settingsWindow.focus();
      return;
    }
  }

  // Ensure only one window is visible
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../renderer/preload.js')
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  // Position just below the tray/menu bar icon
  positionWindowBelowTray(settingsWindow);

  // Open DevTools automatically in development/unpacked runs
  if (isDev && settingsWindow && settingsWindow.webContents) {
    try {
      settingsWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (e) {
      // ignore
    }
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // Hide settings window when it loses focus (unless DevTools is open)
  settingsWindow.on('blur', () => {
    if (settingsWindow && !settingsWindow.webContents.isDevToolsOpened()) {
      settingsWindow.hide();
    }
  });
}

/**
 * Position window at cursor location
 */
function positionWindowBelowTray(targetWindow) {
  if (!targetWindow) return;

  const { screen } = require('electron');
  const trayBounds = trayManager && trayManager.tray ? trayManager.tray.getBounds() : null;
  const display = screen.getPrimaryDisplay();

  const windowBounds = targetWindow.getBounds();

  let x;
  let y;

  if (trayBounds) {
    // Center align below tray icon
    x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    y = Math.round(trayBounds.y + trayBounds.height + 8);
  } else {
    // Fallback: top center of primary display
    x = Math.round(display.bounds.x + (display.bounds.width - windowBounds.width) / 2);
    y = Math.round(display.bounds.y + 32);
  }

  // Keep window within display bounds
  const maxX = display.bounds.x + display.bounds.width - windowBounds.width;
  const maxY = display.bounds.y + display.bounds.height - windowBounds.height;
  x = Math.max(display.bounds.x, Math.min(x, maxX));
  y = Math.max(display.bounds.y, Math.min(y, maxY));

  targetWindow.setPosition(x, y);
}

/**
 * Download file with basic redirect handling
 */
function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    const handleResponse = (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirects
        const redirectUrl = response.headers.location;
        response.destroy();
        https.get(redirectUrl, handleResponse).on('error', reject);
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Failed to download. Status code: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    };

    https.get(url, handleResponse).on('error', (err) => {
      fs.unlink(destination, () => reject(err));
    });
  });
}

// Select appropriate update asset and download to Downloads folder
async function downloadUpdateAsset(updateInfo) {
  if (!updateInfo || !updateInfo.files || updateInfo.files.length === 0) {
    throw new Error('No update files available');
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const preferOrder = ['.dmg', '.zip'];

  let fileEntry = null;
  for (const ext of preferOrder) {
    fileEntry = updateInfo.files.find(f => f.url && f.url.includes(`-mac-${arch}`) && f.url.endsWith(ext));
    if (fileEntry) break;
  }
  if (!fileEntry) {
    for (const ext of preferOrder) {
      fileEntry = updateInfo.files.find(f => f.url && f.url.endsWith(ext));
      if (fileEntry) break;
    }
  }
  if (!fileEntry) fileEntry = updateInfo.files[0];
  if (!fileEntry) throw new Error('No downloadable file found for update');

  const fileName = fileEntry.url || fileEntry.name || fileEntry.path;
  if (!fileName) throw new Error('No file name available for update asset');

  let downloadUrl;
  try {
    downloadUrl = new URL(fileName).toString();
  } catch (e) {
    const owner = 'rrajendran';
    const repo = 'clyp';
    downloadUrl = `https://github.com/${owner}/${repo}/releases/download/v${updateInfo.version}/${fileName}`;
  }

  const downloadsDir = app.getPath('downloads');
  const filename = path.basename(fileName);
  const destination = path.join(downloadsDir, filename);

  await downloadFile(downloadUrl, destination);
  console.log('Update downloaded to', destination);
  await shell.openPath(destination);

  return { success: true, path: destination };
}

/**
 * Show main window
 */
function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  }

  // Ensure only one window visible
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.hide();
  }

  positionWindowBelowTray(mainWindow);
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Register global shortcuts
 */
function registerShortcuts() {
  const settings = storageManager.getSettings();
  const rawShortcut = settings.shortcut || (process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V');
  const settingsShortcut = process.platform === 'darwin' ? 'Command+,' : 'Control+,';

  // Helper: normalize accelerator tokens into canonical electron accelerator form
  function normalizeAccelerator(accel) {
    if (!accel || typeof accel !== 'string') return accel;
    // Remove whitespace and normalize separators
    const parts = accel.split('+').map(p => p.trim()).filter(Boolean);
    const mapped = parts.map(token => {
      const t = token.toLowerCase();
      if (t === 'cmd' || t === 'command' || t === 'ctrl' || t === 'control') return 'CommandOrControl';
      if (t === 'cmdorcontrol' || t === 'commandorcontrol') return 'CommandOrControl';
      if (t === 'alt' || t === 'option') return 'Alt';
      if (t === 'shift') return 'Shift';
      // Keep function keys and arrows as-is (case preserved below)
      if (/^f\d{1,2}$/i.test(t)) return token.toUpperCase();
      if (/^arrow(up|down|left|right)$/i.test(t)) return token.charAt(0).toUpperCase() + token.slice(1);
      // Single character keys -> uppercase
      if (t.length === 1) return token.toUpperCase();
      // Default fallback - preserve token casing
      return token;
    });
    // Join using +
    return mapped.join('+');
  }

  const normalizedShortcut = normalizeAccelerator(rawShortcut);

  // Validate normalized accelerator: must contain a non-modifier main key
  const modifierSet = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift', 'Option']);
  const tokens = normalizedShortcut.split('+').map(t => t.trim()).filter(Boolean);
  const hasMainKey = tokens.some(t => !modifierSet.has(t));
  if (!hasMainKey) {
    const defaultRaw = process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V';
    const fallback = normalizeAccelerator(defaultRaw);
    console.warn('Invalid shortcut (modifiers only) for', rawShortcut, '- falling back to', defaultRaw);
    // Use fallback
    tokens.length = 0;
    tokens.push(...fallback.split('+'));
  }

  // Unregister all shortcuts first
  globalShortcut.unregisterAll();

  // Final accelerator string for registration
  const finalShortcut = tokens.join('+');

  // Register clipboard history shortcut
  const registered = globalShortcut.register(finalShortcut, () => {
    showMainWindow();
  });

  if (!registered) {
    console.error('Failed to register global shortcut:', rawShortcut, '(attempted ->', finalShortcut + ')');
  } else {
    console.log('Registered global shortcut:', rawShortcut, '(normalized ->', finalShortcut + ')');
  }
  
  // Note: Settings shortcut (Cmd+, / Ctrl+,) is handled via menu accelerator
  // and only works when the app has focus, not globally
}

/**
 * Create application menu
 */
function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'Cmd+,',
          click: () => createSettingsWindow()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    (() => {
      const viewSubmenu = [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ];

      try {
        const settings = storageManager ? storageManager.getSettings() : {};
        if (settings.developerTools === true) {
          viewSubmenu.push({ type: 'separator' });
          viewSubmenu.push({
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => {
              const focused = BrowserWindow.getFocusedWindow() || settingsWindow || mainWindow;
              if (focused && focused.webContents) {
                if (focused.webContents.isDevToolsOpened()) focused.webContents.closeDevTools();
                else focused.webContents.openDevTools({ mode: 'detach' });
              }
            }
          });
        }
      } catch (e) {
        // ignore
      }

      return { label: 'View', submenu: viewSubmenu };
    })(),
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Initialize the application
 */
function initialize() {
  console.log('Initializing storage...');
  // Initialize storage
  storageManager = new StorageManager();
  
  // Create application menu
  createApplicationMenu();

  // Sync start on boot setting with OS
  let settings = storageManager.getSettings();
  const loginItemSettings = app.getLoginItemSettings();
  if (settings.startOnBoot !== loginItemSettings.openAtLogin) {
    app.setLoginItemSettings({
      openAtLogin: settings.startOnBoot,
      openAsHidden: true
    });
  }

  console.log('Initializing tray...');
  // Initialize tray
  trayManager = new TrayManager(storageManager);
  trayManager.on('show-history', showMainWindow);
  trayManager.on('show-settings', createSettingsWindow);
  trayManager.on('clear-history', () => {
    storageManager.clearHistory();
    if (mainWindow) {
      mainWindow.webContents.send('history-updated', storageManager.getHistory());
    }
  });
  trayManager.on('toggle-monitoring', (enabled) => {
    if (enabled) {
      clipboardMonitor.start();
    } else {
      clipboardMonitor.stop();
    }
  });
  trayManager.on('toggle-dev-tools', () => {
    // Try to toggle dev tools on active window
    const activeWindow = BrowserWindow.getFocusedWindow();
    if (activeWindow) {
      if (activeWindow.webContents.isDevToolsOpened()) {
        activeWindow.webContents.closeDevTools();
      } else {
        activeWindow.webContents.openDevTools();
      }
    } else if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.webContents.isDevToolsOpened()) {
        settingsWindow.webContents.closeDevTools();
      } else {
        settingsWindow.webContents.openDevTools();
      }
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });
  trayManager.on('quit', () => {
    app.quit();
  });

  console.log('Initializing clipboard monitor...');
  // Initialize clipboard monitor
  clipboardMonitor = new ClipboardMonitor(storageManager, isDev);
  clipboardMonitor.on('clipboard-change', (item) => {
    if (mainWindow) {
      mainWindow.webContents.send('history-updated', storageManager.getHistory());
    }
  });

  // Enable monitoring integration (optional - for development/debugging)
  clipboardMonitor.enableMonitoring((metrics) => {
    if (isDev) {
      console.log('Clipboard Monitor Performance:', {
        checks: metrics.checksPerformed,
        items: metrics.itemsDetected,
        hitRate: metrics.hitRate,
        errors: metrics.errors,
        pollInterval: metrics.pollInterval,
        powerMode: metrics.powerMode
      });
    }
  }, 60000); // Report every 60 seconds

  // Clean up any existing duplicates
  console.log('Removing any existing duplicates...');
  storageManager.removeDuplicates();

  console.log('Registering global shortcuts...');
  // Register global shortcuts
  registerShortcuts();

  console.log('Starting clipboard monitoring...');
  // Start clipboard monitoring if enabled
  settings = storageManager.getSettings();
  if (settings.monitoringEnabled !== false) {
    clipboardMonitor.start();
  }
  // Hide dock icon on macOS if configured to run in background
  try {
    if (process.platform === 'darwin' && settings.hideDockIcon) {
      try { app.dock.hide(); } catch (e) { /* ignore if not supported */ }
    }
  } catch (e) {
    console.warn('Failed to apply hideDockIcon setting:', e.message);
  }
  
  console.log('Initialization complete!');
  
  // Check for updates on startup (non-dev builds only) with prompt
  if (!isDev) {
    setTimeout(() => {
      checkForUpdatesAndPrompt();
    }, 5000); // Wait 5 seconds after startup
  }
}

// App lifecycle events
app.whenReady().then(() => {
  console.log('Electron app ready, initializing...');
  try {
    // Set macOS Dock icon (safe no-op on other platforms)
    if (process.platform === 'darwin') {
      try {
        const dockIcon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icons/png/128x128.png'));
        if (dockIcon && !dockIcon.isEmpty()) {
          app.dock.setIcon(dockIcon);
        }
      } catch (e) {
        console.warn('Failed to set Dock icon:', e.message);
      }
    }
    initialize();
    console.log('Clyp initialized successfully. App is running in background.');
    console.log('Press Cmd+Shift+V (Mac) or Ctrl+Shift+V (Windows/Linux) to open clipboard history.');
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}).catch((error) => {
  console.error('App initialization failed:', error);
  process.exit(1);
});

app.on('window-all-closed', () => {
  // Don't quit on window close - app runs in background with tray icon
  // On macOS it is common for applications to stay open even with no windows
  // On Windows/Linux, we also keep running because we have a tray icon
  // The user can quit via the tray menu
});

app.on('activate', () => {
  // On macOS, show window when dock icon is clicked
  if (mainWindow === null) {
    showMainWindow();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  
  // Stop clipboard monitoring
  if (clipboardMonitor) {
    clipboardMonitor.stop();
  }
});

// Prompted update check used on startup
async function checkForUpdatesAndPrompt() {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      const currentVersion = app.getVersion();
      const latestVersion = result.updateInfo.version;
      if (currentVersion !== latestVersion) {
        const { response } = await dialog.showMessageBox({
          type: 'info',
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Available',
          message: `Version ${latestVersion} is available.`,
          detail: 'Download the installer now? It will be saved to Downloads and opened for installation.',
          noLink: true
        });

        if (response === 0) {
          const downloadResult = await downloadUpdateAsset(result.updateInfo);
          if (!downloadResult.success) {
            await dialog.showMessageBox({
              type: 'error',
              buttons: ['OK'],
              message: 'Failed to download update.',
              detail: downloadResult.error || 'Unknown error'
            });
          }
        }
      }
    }
  } catch (error) {
    console.log('Auto-update check failed:', error.message || error);
  }
}

// IPC handlers
ipcMain.handle('get-history', () => {
  return storageManager.getHistory();
});

ipcMain.handle('get-settings', () => {
  return storageManager.getSettings();
});

ipcMain.handle('update-settings', (event, settings) => {
  storageManager.updateSettings(settings);
  
  // Re-register shortcuts if changed
  registerShortcuts();
  
  // Update monitoring state
  if (settings.monitoringEnabled !== undefined) {
    if (settings.monitoringEnabled) {
      clipboardMonitor.start();
    } else {
      clipboardMonitor.stop();
    }
  }
  
  // Update tray menu to reflect new settings
  trayManager.updateMenu();
  // Rebuild application menu so changes like developerTools are reflected immediately
  try {
    createApplicationMenu();
  } catch (e) {
    console.warn('Failed to recreate application menu after settings update:', e.message);
  }
  // Apply hideDockIcon setting on macOS immediately
  if (process.platform === 'darwin' && settings.hideDockIcon !== undefined) {
    try {
      if (settings.hideDockIcon) {
        try { app.dock.hide(); } catch (e) {}
      } else {
        try { app.dock.show(); } catch (e) {}
      }
    } catch (e) {
      console.warn('Failed to toggle dock visibility:', e.message);
    }
  }
  
  // Broadcast settings change to all windows
  const updatedSettings = storageManager.getSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed', updatedSettings);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings-changed', updatedSettings);
  }
  
  return true;
});

ipcMain.handle('delete-item', (event, id) => {
  storageManager.deleteItem(id);
  return storageManager.getHistory();
});

ipcMain.handle('pin-item', (event, id) => {
  storageManager.togglePin(id);
  return storageManager.getHistory();
});

ipcMain.handle('copy-to-clipboard', (event, content) => {
  const { clipboard } = require('electron');
  const beautify = require('js-beautify').html;
  // Pause monitoring to avoid capturing our own write
  clipboardMonitor.pause();
  try {
    // Support payloads with both text and html so formatting is preserved
    if (content && typeof content === 'object' && (content.html || content.text)) {
      const writeData = {};
      if (content.text) writeData.text = content.text;

      // If the provided HTML appears to include inline styling or syntax-
      // highlighting markup (spans, style attributes, classes), replace the
      // html flavor with a safe <pre> that contains the escaped source text.
      // This prevents rich paste targets from receiving the styled DOM and
      // instead receives readable, raw source formatting.
      const likelyStyled = content.html && /<span\b|\bstyle=|\bclass=/.test(content.html);
      if (content.html && likelyStyled) {
        const escapeHtml = (str) => {
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
        const sourceText = content.text || content.html;
        // Format the source using js-beautify for consistent indentation
        const formatted = (() => {
          try { return beautify(sourceText, { indent_size: 2, wrap_line_length: 0 }); } catch (e) { return sourceText; }
        })();
        writeData.html = `<pre style="white-space: pre-wrap; font-family: Menlo, Monaco, 'Courier New', monospace;">${escapeHtml(formatted)}</pre>`;
      } else if (content.html) {
        // Format HTML for the html flavor too (keeps rich paste tidy)
        try {
          writeData.html = beautify(content.html, { indent_size: 2, wrap_line_length: 0 });
        } catch (e) {
          writeData.html = content.html;
        }
      }

      // Use clipboard.write to set multiple formats at once
      clipboard.write(writeData);
    } else {
      // Fallback: write plain text
      clipboard.writeText(typeof content === 'string' ? content : String(content));
    }

    // Remember that we wrote this content; store payload so we can detect
    // whether the clipboard has been changed by the user before clearing it.
    lastAppCopiedContent = content;
    if (lastAppCopyTimer) clearTimeout(lastAppCopyTimer);
    // Fallback: clear after 30s if the window isn't hidden
    lastAppCopyTimer = setTimeout(() => {
        try {
          // Only clear if the clipboard still contains the same content we set
          try {
            const currentText = clipboard.readText();
            const currentHTML = clipboard.readHTML();
            const isUnchanged = (() => {
              if (!lastAppCopiedContent) return false;
              if (typeof lastAppCopiedContent === 'string') {
                return currentText === lastAppCopiedContent;
              }
              if (typeof lastAppCopiedContent === 'object') {
                const textMatch = lastAppCopiedContent.text ? currentText === lastAppCopiedContent.text : true;
                const htmlMatch = lastAppCopiedContent.html ? currentHTML === lastAppCopiedContent.html : true;
                return textMatch && htmlMatch;
              }
              return false;
            })();

            if (isUnchanged) clipboard.clear();
          } catch (e) {
            // If reading fails for any reason, avoid clobbering clipboard
            console.warn('Could not verify clipboard before clearing:', e.message);
          }
        } catch (err) {
          console.error('Failed to clear clipboard on fallback:', err);
        } finally {
          lastAppCopiedContent = null;
          clipboardMonitor.resume();
        }
    }, 30000);
  } catch (err) {
    console.error('copy-to-clipboard failed:', err);
    clipboardMonitor.resume();
  }
  return true;
});

ipcMain.handle('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide();
    try {
      const { clipboard } = require('electron');
      if (lastAppCopiedContent) {
        // Schedule a short grace period (5s) to allow users to paste after
        // copying before we clear the clipboard and resume monitoring.
        if (lastAppCopyTimer) clearTimeout(lastAppCopyTimer);
        lastAppCopyTimer = setTimeout(() => {
          try {
            // Only clear if clipboard still holds what we set
            try {
              const currentText = clipboard.readText();
              const currentHTML = clipboard.readHTML();
              const isUnchanged = (() => {
                if (!lastAppCopiedContent) return false;
                if (typeof lastAppCopiedContent === 'string') {
                  return currentText === lastAppCopiedContent;
                }
                if (typeof lastAppCopiedContent === 'object') {
                  const textMatch = lastAppCopiedContent.text ? currentText === lastAppCopiedContent.text : true;
                  const htmlMatch = lastAppCopiedContent.html ? currentHTML === lastAppCopiedContent.html : true;
                  return textMatch && htmlMatch;
                }
                return false;
              })();

              if (isUnchanged) clipboard.clear();
            } catch (e) {
              console.warn('Could not verify clipboard before clearing on hide-window:', e.message);
            }
          } catch (err) {
            console.error('Failed to handle hide-window clipboard logic:', err);
          } finally {
            lastAppCopiedContent = null;
            lastAppCopyTimer = null;
            clipboardMonitor.resume();
          }
        }, 5000);
      } else {
        // No recent app-copied content, just resume monitoring
        clipboardMonitor.resume();
      }
    } catch (err) {
      console.error('Failed to handle hide-window clipboard logic:', err);
      clipboardMonitor.resume();
    }
  }
  return true;
});

ipcMain.handle('show-settings', () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle('clear-history', () => {
  try {
    const history = storageManager.clearHistory();
    return { success: true, history };
  } catch (error) {
    console.error('Failed to clear history:', error);
    throw error;
  }
});

ipcMain.handle('get-asset-path', (event, assetPath) => {
  try {
    const basePath = path.join(__dirname, '../../assets');
    return `file://${path.join(basePath, assetPath)}`;
  } catch (error) {
    console.error('Failed to get asset path:', error);
    throw error;
  }
});

ipcMain.handle('add-tag-to-item', (event, id, tag) => {
  try {
    const history = storageManager.addTagToItem(id, tag);
    return { success: true, history };
  } catch (error) {
    console.error('Failed to add tag:', error);
    throw error;
  }
});

ipcMain.handle('remove-tag-from-item', (event, id, tag) => {
  try {
    const history = storageManager.removeTagFromItem(id, tag);
    return { success: true, history };
  } catch (error) {
    console.error('Failed to remove tag:', error);
    throw error;
  }
});

ipcMain.handle('get-all-tags', () => {
  try {
    const tags = storageManager.getAllTags();
    return { success: true, tags };
  } catch (error) {
    console.error('Failed to get tags:', error);
    throw error;
  }
});

ipcMain.handle('clear-all-data', () => {
  try {
    storageManager.clearAllData();
    return { success: true };
  } catch (error) {
    console.error('Failed to clear all data:', error);
    throw error;
  }
});

ipcMain.handle('remove-duplicates', () => {
  try {
    const history = storageManager.removeDuplicates();
    return { success: true, history };
  } catch (error) {
    console.error('Failed to remove duplicates:', error);
    throw error;
  }
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.quit();
});

ipcMain.handle('open-external', (event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
  return true;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  try {
    console.log('Checking for updates...');
    console.log('Current version:', app.getVersion());
    console.log('Is dev mode:', isDev);
    console.log('Feed URL:', autoUpdater.getFeedURL());
    
    const result = await autoUpdater.checkForUpdates();
    console.log('Update check result:', result);
    
    if (result && result.updateInfo) {
      const currentVersion = app.getVersion();
      const latestVersion = result.updateInfo.version;
      console.log(`Current: ${currentVersion}, Latest: ${latestVersion}`);
      
      if (currentVersion !== latestVersion) {
        return {
          available: true,
          version: latestVersion,
          releaseNotes: result.updateInfo.releaseNotes || '',
          releaseDate: result.updateInfo.releaseDate || ''
        };
      }
    }
    return { available: false };
  } catch (error) {
    console.error('Update check failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
});

ipcMain.handle('download-update', async () => {
  try {
    console.log('Starting update download...');
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      throw new Error('No update info available');
    }

    return await downloadUpdateAsset(result.updateInfo);
  } catch (error) {
    console.error('Update download failed:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
});

ipcMain.handle('install-update', () => {
  console.log('Installing update and restarting...');
  // setImmediate ensures all windows are closed properly before quitting
  setImmediate(() => {
    autoUpdater.quitAndInstall(true, true);
  });
});

ipcMain.handle('set-start-on-boot', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true
  });
  return true;
});
