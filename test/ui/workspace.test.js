const test = require('node:test');
const assert = require('node:assert/strict');
const { load, tick, key } = require('./harness');

const visibleIds = (doc) => [...doc.querySelectorAll('#historyList .history-item')].map((e) => e.dataset.id);
const group = (doc, id) => [...doc.querySelectorAll(`#${id} .sidebar-item`)].map((b) => b.dataset.target);

test('sidebar has a Clipboard group and a Settings group with the right pages', async () => {
  const { doc } = await load('settings.html');
  const headings = [...doc.querySelectorAll('.nav-heading')].map((h) => h.textContent);
  assert.deepEqual(headings, ['Clipboard', 'Settings']);
  const clip = [...doc.querySelectorAll('.nav-group')[0].querySelectorAll('.sidebar-item')].map((b) => b.dataset.target);
  const sets = [...doc.querySelectorAll('.nav-group')[1].querySelectorAll('.sidebar-item')].map((b) => b.dataset.target);
  assert.deepEqual(clip, ['clipboard/all', 'clipboard/text', 'clipboard/image', 'clipboard/pinned']);
  assert.deepEqual(sets, ['general', 'capture', 'appearance', 'privacy', 'shortcuts', 'about']);
});

test('clipboard counts are shown next to All / Text / Images / Pinned', async () => {
  const { doc } = await load('settings.html');
  const n = (k) => doc.querySelector(`[data-count="${k}"]`).textContent;
  assert.equal(n('all'), '6');
  assert.equal(n('text'), '5'); // 4 text + 1 rich text
  assert.equal(n('image'), '1');
  assert.equal(n('pinned'), '1');
});

test('clipboard pages filter the list: All, Text, Images, Pinned', async () => {
  const { doc } = await load('settings.html', { query: '?go=clipboard/all' });
  const go = (t) => doc.querySelector(`.sidebar-item[data-target="${t}"]`).click();
  assert.equal(visibleIds(doc).length, 6);
  go('clipboard/image');
  assert.deepEqual(visibleIds(doc), ['5']);
  go('clipboard/pinned');
  assert.deepEqual(visibleIds(doc), ['3']);
  go('clipboard/text');
  assert.equal(visibleIds(doc).length, 5);
  assert.equal(doc.getElementById('topbarTitle').textContent, 'Text');
  assert.equal(doc.getElementById('topbarGroup').textContent, 'Clipboard');
  assert.equal(doc.getElementById('app').dataset.view, 'clipboard');
  assert.ok(doc.getElementById('clipboard').classList.contains('active'));
});

test('landing page comes from ?go= and defaults to General', async () => {
  let ui = await load('settings.html', { query: '?go=clipboard/pinned' });
  assert.deepEqual(visibleIds(ui.doc), ['3']);
  assert.ok(ui.doc.querySelector('.sidebar-item[data-target="clipboard/pinned"]').classList.contains('active'));
  ui = await load('settings.html');
  assert.ok(ui.doc.getElementById('general').classList.contains('active'));
  assert.equal(ui.doc.getElementById('app').dataset.view, 'settings');
  ui = await load('settings.html', { query: '?go=nonsense/../x' });
  assert.ok(ui.doc.getElementById('general').classList.contains('active'), 'bad targets fall back safely');
});

test('navigate event from the backend switches page', async () => {
  const ui = await load('settings.html');
  ui.emit('navigate', 'clipboard/image');
  assert.deepEqual(visibleIds(ui.doc), ['5']);
  ui.emit('navigate', 'appearance');
  assert.ok(ui.doc.getElementById('appearance').classList.contains('active'));
  assert.equal(ui.doc.getElementById('app').dataset.view, 'settings');
});

test('search box is part of the clipboard view and hidden for settings via data-view', async () => {
  const { doc, win } = await load('settings.html', { query: '?go=clipboard/all' });
  const input = doc.getElementById('searchInput');
  input.value = 'newest';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.deepEqual(visibleIds(doc), ['2']);
  assert.equal(doc.getElementById('app').dataset.view, 'clipboard');
  doc.querySelector('.sidebar-item[data-target="general"]').click();
  assert.equal(doc.getElementById('app').dataset.view, 'settings'); // CSS hides .topbar-search here
});

test('copying in the big window keeps it open (no hide_window) and toasts', async () => {
  const { doc, win, calls } = await load('settings.html', { query: '?go=clipboard/all' });
  doc.querySelector('#historyList .history-item[data-id="2"]').click();
  await tick(win);
  assert.ok(calls.some((c) => c.cmd === 'copy_to_clipboard'));
  assert.ok(!calls.some((c) => c.cmd === 'hide_window'));
  assert.equal(doc.querySelector('.toast').textContent.includes('Copied'), true);
});

test('typing in a settings field does not hijack focus to the search box', async () => {
  const { doc, win } = await load('settings.html', { query: '?go=general' });
  const num = doc.getElementById('maxHistorySize');
  num.focus();
  key(win, num, '5');
  assert.equal(doc.activeElement, num);
});

test('keyboard list navigation works in the big window', async () => {
  const { doc, win } = await load('settings.html', { query: '?go=clipboard/all' });
  key(win, doc, 'ArrowDown');
  assert.equal(doc.querySelector('#historyList .history-item.selected').dataset.id, '3');
});

test('sidebar drawer toggles, remembers its state and updates aria', async () => {
  const { doc, win } = await load('settings.html');
  const app = doc.getElementById('app'), toggle = doc.getElementById('sidebarToggle');
  assert.equal(app.dataset.sidebar, 'open');
  toggle.click();
  assert.equal(app.dataset.sidebar, 'closed');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(win.localStorage.getItem('clyp-sidebar'), 'closed');
  toggle.click();
  assert.equal(app.dataset.sidebar, 'open');
  assert.equal(win.localStorage.getItem('clyp-sidebar'), 'open');
});

test('sidebar starts closed when it was left closed', async () => {
  const { doc } = await load('settings.html', { sidebar: 'closed' });
  assert.equal(doc.getElementById('app').dataset.sidebar, 'closed');
});

test('narrow window: sidebar is an overlay drawer that closes after choosing a page', async () => {
  const { doc } = await load('settings.html', { narrow: true, sidebar: 'open' });
  const app = doc.getElementById('app');
  assert.equal(app.dataset.sidebar, 'closed', 'starts closed regardless of saved state');
  doc.getElementById('sidebarToggle').click();
  assert.equal(app.dataset.sidebar, 'open');
  doc.querySelector('.sidebar-item[data-target="capture"]').click();
  assert.equal(app.dataset.sidebar, 'closed');
  doc.getElementById('sidebarToggle').click();
  doc.getElementById('sidebarScrim').click();
  assert.equal(app.dataset.sidebar, 'closed');
});

test('big window copies keep the clipboard (keep=true); popup copies do not', async () => {
  let ui = await load('settings.html', { query: '?go=clipboard/all' });
  ui.doc.querySelector('#historyList .history-item[data-id="2"]').click();
  await tick(ui.win);
  assert.equal(ui.calls.find((c) => c.cmd === 'copy_to_clipboard').args.keep, true);
  ui = await load('index.html');
  ui.doc.querySelector('.history-item[data-id="2"]').click();
  await tick(ui.win);
  assert.equal(ui.calls.find((c) => c.cmd === 'copy_to_clipboard').args.keep, false);
});

test('clipboard list in the big window is a single column of items', async () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'css', 'settings.css'), 'utf8');
  assert.match(css, /\.canvas \.history-list\s*\{[^}]*flex-direction:\s*column/);
  assert.doesNotMatch(css, /grid-template-columns/);
});
