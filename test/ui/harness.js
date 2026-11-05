// Loads the real popup / settings page in jsdom with a mocked Tauri backend.
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const now = Date.now();

function sampleHistory() {
  return [
    { id: '1', timestamp: now - 3600e3, type: 'text', content: 'older text', preview: 'older text', pinned: false, tags: [] },
    { id: '2', timestamp: now - 1e3, type: 'text', content: 'newest text', preview: 'newest text', pinned: false, tags: ['<b>x</b>'] },
    { id: '3', timestamp: now - 7200e3, type: 'text', content: 'pinned text', preview: 'pinned text', pinned: true, tags: [] },
    { id: '4', timestamp: now - 5e3, type: 'html', content: '<p onclick="x()">Hi <script>alert(1)</script><img src=x onerror="y()"><a href="javascript:z()">l</a></p>', preview: 'Hi', pinned: false, tags: [] },
    { id: '5', timestamp: now - 9e3, type: 'image', content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', preview: 'Image (1x1)', pinned: false, tags: [] },
    { id: '6', timestamp: now - 9e3, type: 'text', content: 'line\n'.repeat(10), preview: 'line line', pinned: false, tags: [] },
  ];
}

const DEFAULT_SETTINGS = {
  theme: 'system', maxHistorySize: 100, maxContentSizeMB: 5, monitoringEnabled: true,
  captureText: true, captureRichText: true, captureImages: true, captureFiles: false,
  startOnBoot: false, shortcut: 'Command+Shift+V', autoDeleteHistory: false, autoDeleteDays: 30,
  deletePinnedItems: false, hideDockIcon: false, developerTools: false,
};

async function load(page, { platform = 'MacIntel', dark = false, settings = {}, history = sampleHistory(), query = '', narrow = false, sidebar = null, handlers = {}, confirm = true } = {}) {
  const calls = [];
  const state = { settings: { ...DEFAULT_SETTINGS, ...settings }, history };
  const listeners = {};

  const dom = await JSDOM.fromFile(path.join(SRC, page), {
    url: require('url').pathToFileURL(path.join(SRC, page)).href + query,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'platform', { value: platform });
      window.matchMedia = (q) => ({ matches: (dark && /dark/.test(q)) || (narrow && /max-width/.test(q)), addEventListener() {}, removeEventListener() {} });
      // jsdom has no localStorage for file:// pages: provide a simple one.
      const store = new Map(sidebar ? [['clyp-sidebar', sidebar]] : []);
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      });
      window.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, '\\$&') };
      window.Element.prototype.scrollIntoView = () => {};
      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args = {}) => {
            calls.push({ cmd, args: JSON.parse(JSON.stringify(args)) }); // plain objects, not jsdom-realm ones
            if (handlers[cmd]) return handlers[cmd](args);
            switch (cmd) {
              case 'get_history': return state.history;
              case 'get_settings': return state.settings;
              case 'get_app_version': return '9.9.9';
              case 'get_all_tags': return { success: true, tags: ['alpha'] };
              case 'update_settings': Object.assign(state.settings, args.settings); return { ok: true, warning: null };
              case 'pin_item': state.history.find((h) => h.id === args.id).pinned ^= true; return state.history;
              case 'delete_item': state.history = state.history.filter((h) => h.id !== args.id); return state.history;
              case 'add_tag_to_item': case 'remove_tag_from_item': return { success: true };
              default: return true;
            }
          },
        },
        event: { listen: (name, cb) => { (listeners[name] ||= []).push(cb); } },
        dialog: { confirm: async (message) => { calls.push({ cmd: 'dialog.confirm', args: { message } }); return confirm; } },
      };
    },
  });
  await new Promise((r) => dom.window.addEventListener('load', r));
  await tick(dom.window);
  return { dom, win: dom.window, doc: dom.window.document, calls, state, emit: (n, p) => (listeners[n] || []).forEach((cb) => cb({ payload: p })) };
}

const tick = (win, ms = 20) => new Promise((r) => win.setTimeout(r, ms));
const key = (win, target, k, extra = {}) =>
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

module.exports = { load, tick, key, sampleHistory };
