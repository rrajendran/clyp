// Clyp – settings window (renderer)

let settings = {};
let isRecordingShortcut = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupSettingsListeners();
  setupNavigation();
  setAppVersion();
});

window.clyp.onSettingsChanged((next) => {
  settings = next;
  populateSettings();
});

async function loadSettings() {
  settings = await window.clyp.getSettings();
  populateSettings();
}

function populateSettings() {
  const $ = (id) => document.getElementById(id);

  // General
  $('startOnBoot').checked = !!settings.startOnBoot;
  $('maxHistorySize').value = settings.maxHistorySize ?? 100;
  $('maxContentSizeMB').value = typeof settings.maxContentSizeMB === 'number' ? settings.maxContentSizeMB : 5;
  $('monitoringEnabled').checked = settings.monitoringEnabled !== false;
  $('developerTools').checked = !!settings.developerTools;
  $('hideDockIcon').checked = !!settings.hideDockIcon;

  // Capture
  $('captureText').checked = settings.captureText !== false;
  $('captureRichText').checked = settings.captureRichText !== false;
  $('captureImages').checked = settings.captureImages !== false;
  $('captureFiles').checked = !!settings.captureFiles;

  // Appearance
  const appearance = settings.theme || 'system';
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const on = btn.dataset.appearance === appearance;
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
  window.clyp.applyAppearance(appearance);

  // Privacy
  $('autoDeleteHistory').checked = !!settings.autoDeleteHistory;
  $('autoDeleteDays').value = settings.autoDeleteDays || 30;
  $('deletePinnedItems').checked = !!settings.deletePinnedItems;
  toggleAutoDeleteDays(!!settings.autoDeleteHistory);

  // Shortcuts
  if (!isRecordingShortcut) $('shortcut').value = formatShortcut(settings.shortcut || defaultShortcut());
}

async function setAppVersion() {
  try {
    const version = await window.clyp.getAppVersion();
    document.querySelector('.about-content .version').textContent = `Version ${version}`;
  } catch (err) {
    console.error('Failed to read app version:', err);
  }
}

function setupSettingsListeners() {
  const $ = (id) => document.getElementById(id);

  // Toggles
  const bindToggle = (id, key, after) => $(id).addEventListener('change', async (e) => {
    await updateSetting(key, e.target.checked);
    if (after) after(e.target.checked);
  });
  bindToggle('startOnBoot', 'startOnBoot');
  bindToggle('monitoringEnabled', 'monitoringEnabled');
  bindToggle('developerTools', 'developerTools');
  bindToggle('hideDockIcon', 'hideDockIcon');
  bindToggle('captureText', 'captureText');
  bindToggle('captureRichText', 'captureRichText');
  bindToggle('captureImages', 'captureImages');
  bindToggle('captureFiles', 'captureFiles');
  bindToggle('autoDeleteHistory', 'autoDeleteHistory', toggleAutoDeleteDays);
  bindToggle('deletePinnedItems', 'deletePinnedItems');

  // Numbers (clamped to the ranges declared in the markup)
  const bindNumber = (id, key, toast) => $(id).addEventListener('change', async (e) => {
    const el = e.target;
    const min = Number(el.min), max = Number(el.max);
    let n = parseInt(el.value, 10);
    if (Number.isNaN(n)) n = settings[key];
    n = Math.min(max, Math.max(min, n));
    el.value = n;
    await updateSetting(key, n);
    if (toast) showToast(toast(n), 'success');
  });
  bindNumber('maxHistorySize', 'maxHistorySize', (n) => `History size set to ${n}`);
  bindNumber('maxContentSizeMB', 'maxContentSizeMB');
  bindNumber('autoDeleteDays', 'autoDeleteDays');

  // Appearance
  const options = Array.from(document.querySelectorAll('.theme-option'));
  const choose = (btn) => {
    const value = btn.dataset.appearance;
    options.forEach((o) => { o.setAttribute('aria-checked', String(o === btn)); o.tabIndex = o === btn ? 0 : -1; });
    window.clyp.applyAppearance(value); // instant feedback; backend syncs native chrome
    updateSetting('theme', value);
  };
  options.forEach((btn, i) => {
    btn.addEventListener('click', () => choose(btn));
    btn.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = options[(i + step + options.length) % options.length];
      next.focus();
      choose(next);
    });
  });

  // Clear history
  $('clearAllData').addEventListener('click', async () => {
    const ok = await window.clyp.confirm('Clear clipboard history? Pinned items will be kept unless you have chosen to include them.');
    if (ok) clearHistory();
  });

  // Shortcut recorder
  const shortcut = $('shortcut');
  shortcut.addEventListener('click', startRecordingShortcut);
  shortcut.addEventListener('keydown', recordShortcutKey);
  shortcut.addEventListener('keyup', commitShortcut);
  shortcut.addEventListener('blur', stopRecordingShortcut);

  // About
  document.querySelectorAll('[data-link]').forEach((btn) =>
    btn.addEventListener('click', () => window.clyp.openExternal(btn.dataset.link)));
  $('buyCoffeeBtn').addEventListener('click', () => window.clyp.openExternal('https://buymeacoffee.com/ramesh.rajendran'));
  $('checkUpdatesBtn').addEventListener('click', checkForUpdates);
}

// ---------------------------------------------------------------------------
// Navigation: sidebar drawer + pages
// ---------------------------------------------------------------------------

const GROUPS = { clipboard: 'Clipboard', settings: 'Settings' };
const SETTINGS_PAGES = ['general', 'capture', 'appearance', 'privacy', 'shortcuts', 'about'];
const CLIPBOARD_FILTERS = ['all', 'text', 'image', 'pinned'];
const SIDEBAR_KEY = 'clyp-sidebar';

// target: "clipboard/<all|text|image|pinned>" or a settings page id.
function navigate(target) {
  let [group, page] = String(target || '').split('/');
  let view;
  if (group === 'clipboard') {
    page = CLIPBOARD_FILTERS.includes(page) ? page : 'all';
    view = 'clipboard';
    window.clypView.setFilter(page);
    target = `clipboard/${page}`;
  } else {
    page = SETTINGS_PAGES.includes(group) ? group : 'general';
    view = page;
    group = 'settings';
    target = page;
  }

  const app = document.getElementById('app');
  app.dataset.view = group === 'clipboard' ? 'clipboard' : 'settings';
  if (group !== 'clipboard') window.clypView.closeInspector();

  document.querySelectorAll('.sidebar-item').forEach((item) => {
    const on = item.dataset.target === target;
    item.classList.toggle('active', on);
    if (on) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === view));

  const active = document.querySelector('.sidebar-item.active');
  document.getElementById('topbarGroup').textContent = GROUPS[group];
  document.getElementById('topbarTitle').textContent = active ? active.dataset.title : '';
  document.getElementById('scroller').scrollTop = 0;
}

function setSidebar(open, persist = true) {
  document.getElementById('app').dataset.sidebar = open ? 'open' : 'closed';
  document.getElementById('sidebarToggle').setAttribute('aria-expanded', String(open));
  if (persist) { try { localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed'); } catch (_) { /* ignore */ } }
}

function setupNavigation() {
  const narrow = window.matchMedia('(max-width: 760px)');
  let stored = 'open';
  try { stored = localStorage.getItem(SIDEBAR_KEY) || 'open'; } catch (_) { /* ignore */ }
  setSidebar(!narrow.matches && stored !== 'closed', false);
  narrow.addEventListener('change', () => setSidebar(!narrow.matches && stored !== 'closed', false));

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const open = document.getElementById('app').dataset.sidebar !== 'open';
    stored = open ? 'open' : 'closed';
    setSidebar(open, !narrow.matches);
  });
  document.getElementById('sidebarScrim').addEventListener('click', () => setSidebar(false, false));

  document.querySelectorAll('.sidebar-item').forEach((item) =>
    item.addEventListener('click', () => {
      navigate(item.dataset.target);
      if (narrow.matches) setSidebar(false, false); // overlay drawer closes after choosing
    }));

  // Landing page: ?go=... (set when the window is created) or a later event.
  navigate(new URLSearchParams(location.search).get('go') || 'general');
  window.clyp.onNavigate((target) => navigate(target));
}

async function updateSetting(key, value) {
  settings[key] = value;
  try {
    const result = await window.clyp.updateSettings({ [key]: value });
    if (result && result.warning) showToast(result.warning, 'error');
    return result;
  } catch (err) {
    showToast(`Could not save: ${err}`, 'error');
  }
}

async function clearHistory() {
  try {
    await window.clyp.clearHistory();
    showToast('History cleared', 'success');
  } catch (err) {
    showToast(`Failed to clear history: ${err}`, 'error');
  }
}

function toggleAutoDeleteDays(enabled) {
  document.getElementById('autoDeleteDays').disabled = !enabled;
}

// ---------------------------------------------------------------------------
// Shortcut recording
// ---------------------------------------------------------------------------

const IS_MAC = window.clyp.platform === 'darwin';
const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift', 'Super'];
let recorded = [];

function defaultShortcut() {
  return IS_MAC ? 'Command+Shift+V' : 'Control+Shift+V';
}

// "Command+Shift+V" -> "⌘⇧V" on macOS, "Ctrl+Shift+V" elsewhere.
function formatShortcut(accel) {
  const parts = String(accel).split('+').filter(Boolean);
  if (IS_MAC) {
    const glyph = { Command: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
    return parts.map((p) => glyph[p] || p).join('');
  }
  return parts.map((p) => ({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Super: 'Win' }[p] || p)).join('+');
}

function mainKeyFromEvent(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  return {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  }[c] || null;
}

function startRecordingShortcut() {
  if (isRecordingShortcut) return;
  isRecordingShortcut = true;
  recorded = [];
  const input = document.getElementById('shortcut');
  input.value = 'Press keys…';
  input.classList.add('recording');
}

function recordShortcutKey(e) {
  if (!isRecordingShortcut) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') {
    stopRecordingShortcut();
    document.getElementById('shortcut').blur();
    return;
  }

  const keys = [];
  if (e.metaKey) keys.push(IS_MAC ? 'Command' : 'Super');
  if (e.ctrlKey) keys.push('Control');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  const main = mainKeyFromEvent(e);
  if (main) keys.push(main);

  recorded = keys;
  document.getElementById('shortcut').value = keys.length ? formatShortcut(keys.join('+')) : 'Press keys…';
}

function commitShortcut(e) {
  if (!isRecordingShortcut) return;
  e.preventDefault();
  e.stopPropagation();

  const hasModifier = recorded.some((k) => MODIFIERS.includes(k));
  const hasMain = recorded.some((k) => !MODIFIERS.includes(k));
  const isFunctionKey = recorded.length === 1 && /^F\d{1,2}$/.test(recorded[0]);
  if ((hasModifier && hasMain) || isFunctionKey) {
    const accel = recorded.join('+');
    isRecordingShortcut = false;
    document.getElementById('shortcut').classList.remove('recording');
    document.getElementById('shortcut').value = formatShortcut(accel);
    document.getElementById('shortcut').blur();
    updateSetting('shortcut', accel).then((res) => {
      if (res && !res.warning) showToast('Shortcut updated', 'success');
    });
  }
}

function stopRecordingShortcut() {
  if (!isRecordingShortcut) return;
  isRecordingShortcut = false;
  const input = document.getElementById('shortcut');
  input.classList.remove('recording');
  input.value = formatShortcut(settings.shortcut || defaultShortcut());
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

async function checkForUpdates() {
  const btn = document.getElementById('checkUpdatesBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const result = await window.clyp.checkForUpdates();
    if (result.available) {
      if (await window.clyp.confirm(`Version ${result.version} is available.\n\nOpen the download now?`)) {
        const dl = await window.clyp.downloadUpdate();
        if (dl && dl.success) showToast('Opening download…', 'success');
        else showToast(`Download failed: ${(dl && dl.error) || 'unknown error'}`, 'error');
      }
    } else {
      showToast('You’re up to date', 'success');
    }
  } catch (err) {
    showToast(`Update check failed: ${err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check for Updates';
  }
}
