// Clyp Settings - Renderer Process

let settings = {};
let isRecordingShortcut = false;
let recordedKeys = [];
let pressedKeys = new Set(); // Track currently pressed keys

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  applyTheme();
  setIconPaths();
  setAppVersion();
  initSidebarSizing();
});

// Listen for settings changes from other windows
if (window.electronAPI && window.electronAPI.onSettingsChanged) {
  window.electronAPI.onSettingsChanged(async (newSettings) => {
    settings = newSettings;
    populateSettings();
    applyTheme();
  });
}

// Set icon paths dynamically
async function setIconPaths() {
  try {
    const logoSrc = await window.electronAPI.getAssetPath('icons/png/32x32.png');
    const aboutIconSrc = await window.electronAPI.getAssetPath('icons/png/64x64.png');
    // Support both .logo and legacy .clyp-logo selectors used in this
    // settings template so the header icon is populated correctly.
    const logoElements = document.querySelectorAll('.logo, .clyp-logo');
    logoElements.forEach(el => {
      if (el.dataset.src) {
        el.src = logoSrc;
      }
    });
    
    const aboutLogo = document.querySelector('.about-logo img');
    if (aboutLogo && aboutLogo.dataset.src) {
      aboutLogo.src = aboutIconSrc;
    }
  } catch (error) {
    console.error('Failed to set icon paths:', error);
  }
}

// Load settings
async function loadSettings() {
  settings = await window.electronAPI.getSettings();
  populateSettings();
}

// Populate settings in UI
function populateSettings() {
  // General
  document.getElementById('startOnBoot').checked = settings.startOnBoot || false;
  document.getElementById('maxHistorySize').value = settings.maxHistorySize || 100;
  const mcs = typeof settings.maxContentSizeMB === 'number' ? settings.maxContentSizeMB : 5;
  document.getElementById('maxContentSizeMB').value = mcs;
  document.getElementById('monitoringEnabled').checked = settings.monitoringEnabled !== false;
  document.getElementById('developerTools').checked = settings.developerTools || false;
  document.getElementById('hideDockIcon').checked = settings.hideDockIcon || false;

  // Capture
  document.getElementById('captureText').checked = settings.captureText !== false;
  document.getElementById('captureRichText').checked = settings.captureRichText !== false;
  document.getElementById('captureImages').checked = settings.captureImages !== false;
  document.getElementById('captureFiles').checked = settings.captureFiles || false;

  // Appearance
  document.getElementById('theme').value = settings.theme || 'system';

  // Privacy
  document.getElementById('autoDeleteHistory').checked = settings.autoDeleteHistory || false;
  document.getElementById('autoDeleteDays').value = settings.autoDeleteDays || 30;
  document.getElementById('deletePinnedItems').checked = settings.deletePinnedItems || false;

  // Shortcuts
  document.getElementById('shortcut').value = settings.shortcut || getDefaultShortcut();
}

// Set app version in About section
async function setAppVersion() {
  try {
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.querySelector('.about-content .version');
    if (versionEl && version) {
      versionEl.textContent = `Version ${version}`;
    }
  } catch (error) {
    // Keep default text on failure
    console.error('Failed to set app version:', error);
  }
}

// Get default shortcut for platform
function getDefaultShortcut() {
  const platform = window.electronAPI.getPlatform();
  return platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V';
}

// Setup event listeners
function setupEventListeners() {
  // Sidebar navigation
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      switchSection(section);
    });
  });

  // General settings
  document.getElementById('startOnBoot').addEventListener('change', (e) => {
    updateSetting('startOnBoot', e.target.checked);
    window.electronAPI.setStartOnBoot(e.target.checked);
  });

  document.getElementById('maxHistorySize').addEventListener('change', async (e) => {
    const newSize = parseInt(e.target.value);
    await updateSetting('maxHistorySize', newSize);
    // Notify that history was trimmed
    showNotification(`History size updated to ${newSize}`, 'success');
  });

  document.getElementById('maxContentSizeMB').addEventListener('change', (e) => {
    const val = Math.max(1, parseInt(e.target.value));
    updateSetting('maxContentSizeMB', val);
  });

  document.getElementById('monitoringEnabled').addEventListener('change', (e) => {
    updateSetting('monitoringEnabled', e.target.checked);
  });

  document.getElementById('developerTools').addEventListener('change', (e) => {
    updateSetting('developerTools', e.target.checked);
  });

  const hideDockEl = document.getElementById('hideDockIcon');
  if (hideDockEl) {
    hideDockEl.addEventListener('change', (e) => {
      updateSetting('hideDockIcon', e.target.checked);
    });
  }

  // Capture settings
  document.getElementById('captureText').addEventListener('change', (e) => {
    updateSetting('captureText', e.target.checked);
  });

  document.getElementById('captureRichText').addEventListener('change', (e) => {
    updateSetting('captureRichText', e.target.checked);
  });

  document.getElementById('captureImages').addEventListener('change', (e) => {
    updateSetting('captureImages', e.target.checked);
  });

  document.getElementById('captureFiles').addEventListener('change', (e) => {
    updateSetting('captureFiles', e.target.checked);
  });

  // Appearance settings
  document.getElementById('theme').addEventListener('change', (e) => {
    updateSetting('theme', e.target.value);
    applyTheme();
    // Show/hide transparency slider based on theme
    toggleTransparencySlider(e.target.value);
  });

  // Privacy settings
  document.getElementById('autoDeleteHistory').addEventListener('change', (e) => {
    updateSetting('autoDeleteHistory', e.target.checked);
    toggleAutoDeleteDays(e.target.checked);
  });

  document.getElementById('autoDeleteDays').addEventListener('change', (e) => {
    updateSetting('autoDeleteDays', parseInt(e.target.value));
  });

  document.getElementById('deletePinnedItems').addEventListener('change', (e) => {
    updateSetting('deletePinnedItems', e.target.checked);
  });

  // Clear all data button
  document.getElementById('clearAllData').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all history? Pinned items will be preserved.')) {
      clearAllData();
    }
  });

  // Shortcut recording
  const shortcutInput = document.getElementById('shortcut');
  shortcutInput.addEventListener('click', startRecordingShortcut);
  shortcutInput.addEventListener('keydown', recordShortcutKey);
  shortcutInput.addEventListener('keyup', handleKeyUp);
  shortcutInput.addEventListener('blur', stopRecordingShortcut);

  // About section buttons
  setupAboutButtons();

  // Enable/disable auto-delete days based on toggle
  toggleAutoDeleteDays(settings.autoDeleteHistory);

  // Transparency slider for Spring Glass theme
  const transparencySlider = document.getElementById('transparencySlider');
  if (transparencySlider) {
    transparencySlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      document.getElementById('transparencyValue').textContent = value + '%';
      updateSetting('springGlassTransparency', value);
      // Apply transparency change immediately to the app window
      applySpringGlassTransparency(value);
    });
  }

  // Show transparency slider if Spring Glass is selected
  const currentTheme = settings.theme || 'system';
  toggleTransparencySlider(currentTheme);

  // Load and set transparency value if Spring Glass
  if (currentTheme === 'spring-glass' && settings.springGlassTransparency) {
    document.getElementById('transparencySlider').value = settings.springGlassTransparency;
    document.getElementById('transparencyValue').textContent = settings.springGlassTransparency + '%';
  }
}

// Switch section
function switchSection(section) {
  // Update sidebar
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  sidebarItems.forEach(item => {
    if (item.dataset.section === section) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update main panel
  const sections = document.querySelectorAll('.settings-section');
  sections.forEach(s => {
    if (s.id === section) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });
}

// Update single setting
async function updateSetting(key, value) {
  settings[key] = value;
  await window.electronAPI.updateSettings({ [key]: value });
}

// Clear history
async function clearAllData() {
  try {
    await window.electronAPI.clearHistory();
    showNotification('History has been cleared successfully!', 'success');
    setTimeout(() => {
      window.electronAPI.restartApp();
    }, 1500);
  } catch (error) {
    showNotification('Failed to clear history: ' + error.message, 'error');
  }
}

// Shortcut recording functions
function startRecordingShortcut() {
  if (isRecordingShortcut) return;
  
  isRecordingShortcut = true;
  recordedKeys = [];
  pressedKeys.clear();
  const input = document.getElementById('shortcut');
  input.value = 'Press keys...';
  input.classList.add('recording');
}

function recordShortcutKey(event) {
  if (!isRecordingShortcut) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  const key = event.key;
  const code = event.code;
  const platform = window.electronAPI.getPlatform();
  
  // Build list of currently pressed keys
  const currentKeys = [];
  
  // Detect modifier keys
  if (event.ctrlKey || event.metaKey) {
    const modKey = platform === 'darwin' ? 'Command' : 'Control';
    if (!pressedKeys.has(modKey)) {
      pressedKeys.add(modKey);
    }
    currentKeys.push(modKey);
  }
  if (event.shiftKey) {
    if (!pressedKeys.has('Shift')) {
      pressedKeys.add('Shift');
    }
    currentKeys.push('Shift');
  }
  if (event.altKey) {
    if (!pressedKeys.has('Alt')) {
      pressedKeys.add('Alt');
    }
    currentKeys.push('Alt');
  }
  
  // Add the main key (non-modifier)
  let mainKey = null;
  if (key && key.length === 1 && !['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    // Regular letter/number keys
    mainKey = key.toUpperCase();
  } else if (['Enter', 'Space', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    // Special keys
    mainKey = key;
  } else if (key === ' ') {
    mainKey = 'Space';
  } else if (key && key.startsWith('F') && key.length <= 3 && /^F\d+$/.test(key)) {
    // Function keys
    mainKey = key;
  } else if (code && code.startsWith('Key')) {
    // Fallback for key codes
    mainKey = code.replace('Key', '');
  } else if (code && code.startsWith('Digit')) {
    mainKey = code.replace('Digit', '');
  }
  
  if (mainKey && !['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(mainKey)) {
    if (!pressedKeys.has(mainKey)) {
      pressedKeys.add(mainKey);
    }
    currentKeys.push(mainKey);
  }
  
  // Show the current combination in real-time
  if (currentKeys.length > 0) {
    recordedKeys = currentKeys;
    const shortcut = recordedKeys.join('+');
    document.getElementById('shortcut').value = shortcut;
  }
}

function handleKeyUp(event) {
  if (!isRecordingShortcut) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // Check if we have a valid combination recorded
  if (recordedKeys.length > 0) {
    const hasModifier = recordedKeys.some(key => ['Control', 'Command', 'Shift', 'Alt'].includes(key));
    const hasMainKey = recordedKeys.some(key => !['Control', 'Command', 'Shift', 'Alt'].includes(key));
    const isFunctionKey = recordedKeys.length === 1 && recordedKeys[0].startsWith('F');
    
    if ((hasModifier && hasMainKey) || isFunctionKey) {
      // Valid combination - save it
      const shortcut = recordedKeys.join('+');
      document.getElementById('shortcut').value = shortcut;
      stopRecordingShortcut();
      updateSetting('shortcut', shortcut);
      showNotification('Shortcut updated! Restart required.', 'info');
    }
  }
}

function stopRecordingShortcut() {
  if (!isRecordingShortcut) return;
  
  isRecordingShortcut = false;
  const input = document.getElementById('shortcut');
  input.classList.remove('recording');
  
  if (input.value === 'Press keys...') {
    input.value = settings.shortcut || getDefaultShortcut();
  }
}

// Toggle auto-delete days input
function toggleAutoDeleteDays(enabled) {
  const input = document.getElementById('autoDeleteDays');
  if (input) {
    input.disabled = !enabled;
    input.style.opacity = enabled ? '1' : '0.5';
  }
}

// Toggle transparency slider visibility
function toggleTransparencySlider(theme) {
  const container = document.getElementById('transparencySliderContainer');
  if (container) {
    container.style.display = theme === 'spring-glass' ? 'flex' : 'none';
  }
}

// Apply Spring Glass transparency to CSS variable
function applySpringGlassTransparency(value) {
  const opacity = value / 100;
  const bgColor = `rgba(248, 255, 252, ${opacity})`;
  document.documentElement.style.setProperty('--spring-glass-bg', bgColor);
}

// Apply theme
function applyTheme() {
  const theme = settings.theme || 'system';
  let effectiveTheme = theme;
  
  if (theme === 'system') {
    // Detect system theme
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

// Setup about section buttons
function setupAboutButtons() {
  const aboutButtons = document.querySelectorAll('.about-links .link-btn');
  aboutButtons.forEach(button => {
    button.addEventListener('click', () => {
      const text = button.textContent.trim();
      if (text === 'Documentation') {
        window.electronAPI.openExternal('https://github.com/rrajendran/clyp?tab=readme-ov-file#readme');
      } else if (text === 'Report Issue') {
        window.electronAPI.openExternal('https://github.com/rrajendran/clyp/issues/new');
      } else if (text === 'Check for Updates') {
        checkForUpdates();
      }
    });
  });

  const buyCoffeeBtn = document.getElementById('buyCoffeeBtn');
  if (buyCoffeeBtn) {
    buyCoffeeBtn.addEventListener('click', () => {
      window.electronAPI.openExternal('https://buymeacoffee.com/ramesh.rajendran');
    });
  }
}

// Check for updates
async function checkForUpdates() {
  try {
    const updateBtn = document.getElementById('checkUpdatesBtn');
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.textContent = 'Checking...';
    }
    
    const result = await window.electronAPI.checkForUpdates();
    
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for Updates';
    }
    
    if (result.available) {
      const message = `Version ${result.version} is available!\n\nWould you like to download and install it now?`;
      if (confirm(message)) {
        await downloadAndInstallUpdate(result.version);
      }
    } else {
      showNotification('You are using the latest version.', 'success');
    }
  } catch (error) {
    if (document.getElementById('checkUpdatesBtn')) {
      document.getElementById('checkUpdatesBtn').disabled = false;
      document.getElementById('checkUpdatesBtn').textContent = 'Check for Updates';
    }
    showNotification('Failed to check for updates: ' + (error.message || 'Unknown error'), 'error');
  }
}

// Download and install update
async function downloadAndInstallUpdate(version) {
  try {
    showNotification(`Downloading version ${version}...`, 'info');
    
    const result = await window.electronAPI.downloadUpdate();

    if (result && result.success) {
      showNotification('Update downloaded to Downloads. Opening installer...', 'success');
      return;
    }

    showNotification('Failed to download update: ' + ((result && result.error) || 'Unknown error'), 'error');
  } catch (error) {
    showNotification('Failed to download update: ' + (error.message || 'Unknown error'), 'error');
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#2196f3'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Initialize sidebar resizing
function initSidebarSizing() {
  const sidebar = document.getElementById('settingsSidebar');
  const resizer = document.getElementById('sidebarResizer');
  if (!sidebar || !resizer) return;

  const minWidth = 180;
  const maxWidth = 420;
  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  function onMouseMove(e) {
    if (!dragging) return;
    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;
    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    sidebar.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    // Persist width
    const w = parseInt(sidebar.style.width || '240', 10);
    if (!Number.isNaN(w)) {
      localStorage.setItem('sidebarWidth', String(w));
    }
  }

  resizer.addEventListener('mousedown', (e) => {
    if (sidebar.classList.contains('collapsed')) return;
    dragging = true;
    startX = e.clientX;
    startWidth = parseInt(window.getComputedStyle(sidebar).width, 10);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
