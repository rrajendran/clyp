// Clyp – bridge between the web UI and the Tauri (Rust) backend.
//
// Loaded synchronously in <head> of every window. It
//   1. tags <html> with the host platform and the effective colour scheme
//      *before* first paint (no flash of the wrong theme), and
//   2. exposes `window.clyp`, the only surface the UI uses to reach the
//      backend (replaces the old Electron preload / `electronAPI`).
(() => {
  'use strict';

  // ---- platform -----------------------------------------------------------
  const probe = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  const platform = /Mac(intosh| OS|Intel|PPC)/i.test(probe) ? 'darwin' : /Win(32|64|dows)/i.test(probe) ? 'win32' : 'linux';
  const root = document.documentElement;
  root.dataset.platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform];

  // ---- appearance: light | dark | system -----------------------------------
  const VALID = ['light', 'dark', 'system'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let appearance = 'system';
  try {
    const cached = localStorage.getItem('clyp-appearance');
    if (VALID.includes(cached)) appearance = cached;
  } catch (_) { /* storage unavailable */ }

  function applyAppearance(setting) {
    appearance = VALID.includes(setting) ? setting : 'system';
    const effective = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance;
    root.dataset.theme = effective;
    root.dataset.appearance = appearance;
    try { localStorage.setItem('clyp-appearance', appearance); } catch (_) { /* ignore */ }
  }
  media.addEventListener('change', () => { if (appearance === 'system') applyAppearance('system'); });
  applyAppearance(appearance);

  // ---- backend API ----------------------------------------------------------
  const tauri = window.__TAURI__;
  if (!tauri) {
    console.error('Clyp: Tauri runtime not found – UI is running outside the app shell.');
    return;
  }
  const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
  const on = (event, cb) => { tauri.event.listen(event, (e) => cb(e.payload)); };

  window.clyp = {
    platform,
    applyAppearance,

    // history
    getHistory: () => invoke('get_history'),
    deleteItem: (id) => invoke('delete_item', { id }),
    pinItem: (id) => invoke('pin_item', { id }),
    // keep=true: leave the clipboard alone afterwards (the popup wipes it after use)
    copyToClipboard: (content, keep = false) => invoke('copy_to_clipboard', { content, keep }),
    clearHistory: () => invoke('clear_history'),
    removeDuplicates: () => invoke('remove_duplicates'),

    // tags
    addTagToItem: (id, tag) => invoke('add_tag_to_item', { id, tag }),
    removeTagFromItem: (id, tag) => invoke('remove_tag_from_item', { id, tag }),
    getAllTags: () => invoke('get_all_tags'),

    // windows
    hideWindow: () => invoke('hide_window'),
    // section: e.g. 'general', 'clipboard/pinned' (landing page of the big window)
    showSettings: (section) => invoke('show_settings', { section: section || null }),

    // settings
    getSettings: () => invoke('get_settings'),
    updateSettings: (settings) => invoke('update_settings', { settings }),
    setStartOnBoot: (enabled) => invoke('set_start_on_boot', { enabled }),

    // misc
    openExternal: (url) => invoke('open_external', { url }),
    getAppVersion: () => invoke('get_app_version'),
    checkForUpdates: () => invoke('check_for_updates'),
    downloadUpdate: () => invoke('download_update'),
    confirm: (message, title = 'Clyp') =>
      tauri.dialog.confirm(message, { title, kind: 'warning' }),

    // events
    onHistoryUpdated: (cb) => on('history-updated', cb),
    onSettingsChanged: (cb) => on('settings-changed', cb),
    onNavigate: (cb) => on('navigate', cb),
  };
})();
