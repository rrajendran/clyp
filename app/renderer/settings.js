// Clyp Settings - Renderer Process

let settings = {};
let isRecordingShortcut = false;
let recordedKeys = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  applyTheme();
  setIconPaths();
});

// Set icon paths dynamically
async function setIconPaths() {
  try {
    const logoSrc = await window.electronAPI.getAssetPath('icons/icon-32x32.png');
    const aboutIconSrc = await window.electronAPI.getAssetPath('icons/icon-32x32.png');
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

  document.getElementById('maxHistorySize').addEventListener('change', (e) => {
    updateSetting('maxHistorySize', parseInt(e.target.value));
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
  shortcutInput.addEventListener('blur', stopRecordingShortcut);

  // About section buttons
  setupAboutButtons();

  // Enable/disable auto-delete days based on toggle
  toggleAutoDeleteDays(settings.autoDeleteHistory);
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
  recordedKeys = [];
  
  // Detect modifier keys first
  if (event.ctrlKey || event.metaKey) {
    const platform = window.electronAPI.getPlatform();
    recordedKeys.push(platform === 'darwin' ? 'Command' : 'Control');
  }
  if (event.shiftKey) {
    recordedKeys.push('Shift');
  }
  if (event.altKey) {
    recordedKeys.push('Alt');
  }
  
  // Add the main key
  if (key && key.length === 1) {
    // Regular letter/number keys
    recordedKeys.push(key.toUpperCase());
  } else if (['Enter', 'Space', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    // Special keys
    recordedKeys.push(key);
  } else if (key === ' ') {
    recordedKeys.push('Space');
  } else if (code && code.startsWith('Key')) {
    // Fallback for special key codes
    recordedKeys.push(code.replace('Key', ''));
  } else if (code && code.startsWith('Digit')) {
    recordedKeys.push(code.replace('Digit', ''));
  }
  
  // Require at least one modifier for single-key shortcuts (except function keys)
  const hasModifier = recordedKeys.some(key => ['Control', 'Command', 'Shift', 'Alt'].includes(key));
  const isFunctionKey = key && key.startsWith('F') && key.length <= 3 && /^\d+$/.test(key.substring(1));
  
  if (recordedKeys.length >= 2 || (recordedKeys.length === 1 && isFunctionKey)) {
    const shortcut = recordedKeys.join('+');
    document.getElementById('shortcut').value = shortcut;
    stopRecordingShortcut();
    updateSetting('shortcut', shortcut);
    showNotification('Shortcut updated! Restart required.', 'info');
  } else if (!hasModifier && recordedKeys.length === 1 && !isFunctionKey) {
    // Show hint for invalid shortcut
    showNotification('Shortcuts must include at least one modifier key (Ctrl/Cmd, Shift, Alt)', 'warning');
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
    const updateAvailable = await window.electronAPI.checkForUpdates();
    if (updateAvailable) {
      showNotification('A new update is available!', 'info');
    } else {
      showNotification('You are using the latest version.', 'success');
    }
  } catch (error) {
    showNotification('Failed to check for updates.', 'error');
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
