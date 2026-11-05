const test = require('node:test');
const assert = require('node:assert/strict');
const { load, tick, key } = require('./harness');

const texts = (doc) => [...doc.querySelectorAll('.history-item .item-content')].map((e) => e.textContent.trim());

test('renders items: pinned first, then newest first', async () => {
  const { doc } = await load('index.html');
  const ids = [...doc.querySelectorAll('.history-item')].map((e) => e.dataset.id);
  assert.equal(ids[0], '3', 'pinned item leads');
  assert.equal(ids[1], '2', 'then newest');
  assert.equal(ids.length, 6);
});

test('platform + effective theme are set before first interaction', async () => {
  let ui = await load('index.html', { platform: 'MacIntel' });
  assert.equal(ui.doc.documentElement.dataset.platform, 'macos');
  assert.equal(ui.doc.documentElement.dataset.theme, 'light');
  ui = await load('index.html', { platform: 'Win32', dark: true });
  assert.equal(ui.doc.documentElement.dataset.platform, 'windows');
  assert.equal(ui.doc.documentElement.dataset.theme, 'dark', 'system + OS dark');
  ui = await load('index.html', { platform: 'Linux x86_64', dark: true, settings: { theme: 'light' } });
  assert.equal(ui.doc.documentElement.dataset.platform, 'linux');
  assert.equal(ui.doc.documentElement.dataset.theme, 'light', 'explicit light beats OS dark');
  assert.equal(ui.doc.documentElement.dataset.appearance, 'light');
});

test('settings-changed event re-themes the popup', async () => {
  const ui = await load('index.html');
  ui.emit('settings-changed', { theme: 'dark' });
  await tick(ui.win);
  assert.equal(ui.doc.documentElement.dataset.theme, 'dark');
});

test('search filters by content and tags', async () => {
  const { doc, win } = await load('index.html');
  const input = doc.getElementById('searchInput');
  input.value = 'newest';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.deepEqual(texts(doc), ['newest text']);
  input.value = '<b>x</b>'; // tag text, must match literally
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.history-item').length, 1);
  input.value = 'zzz';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.ok(doc.getElementById('emptyState').classList.contains('visible'));
});

test('filter tabs: Text (includes rich text), Images, Pinned', async () => {
  const { doc } = await load('index.html');
  const click = (f) => doc.querySelector(`.filter-tab[data-filter="${f}"]`).click();
  click('image');
  assert.equal(doc.querySelectorAll('.history-item').length, 1);
  click('pinned');
  assert.equal(doc.querySelectorAll('.history-item').length, 1);
  click('text');
  assert.equal(doc.querySelectorAll('.history-item').length, 5, '4 text + 1 html');
  assert.equal(doc.querySelector('.filter-tab.active').dataset.filter, 'text');
  assert.equal(doc.querySelector('.filter-tab.active').getAttribute('aria-selected'), 'true');
});

test('tags are escaped (no HTML injection)', async () => {
  const { doc } = await load('index.html');
  const tag = doc.querySelector('.history-item[data-id="2"] .tag');
  assert.equal(tag.textContent, '<b>x</b>');
  assert.equal(tag.querySelector('b'), null);
});

test('clipboard HTML is sanitised: no scripts, handlers or javascript: links', async () => {
  const { doc } = await load('index.html');
  const html = doc.querySelector('.history-item[data-id="4"] .html-content');
  assert.ok(html.textContent.includes('Hi'));
  assert.equal(html.querySelector('script'), null);
  assert.equal(html.querySelector('[onclick],[onerror]'), null);
  assert.equal(html.querySelector('a').getAttribute('href'), null);
});

test('long content is flagged and opens the full-content sheet', async () => {
  const { doc } = await load('index.html');
  const content = doc.querySelector('.history-item[data-id="6"] .item-content');
  assert.ok(content.classList.contains('lengthy'));
  assert.ok(!doc.querySelector('.history-item[data-id="5"] .item-content').classList.contains('lengthy'), 'images never lengthy');
  content.click();
  assert.ok(doc.getElementById('textDrawer').classList.contains('open'));
  assert.ok(doc.getElementById('drawerOverlay').classList.contains('active'));
  doc.getElementById('drawerCloseBtn').click();
  assert.ok(!doc.getElementById('textDrawer').classList.contains('open'));
});

test('keyboard: arrows select, Enter copies then hides the window', async () => {
  const { doc, win, calls } = await load('index.html');
  key(win, doc, 'ArrowDown');
  key(win, doc, 'ArrowDown');
  assert.equal(doc.querySelector('.history-item.selected').dataset.id, '2');
  key(win, doc, 'Enter');
  await tick(win);
  const copy = calls.find((c) => c.cmd === 'copy_to_clipboard');
  assert.deepEqual(copy.args.content, { text: 'newest text' });
  assert.ok(calls.some((c) => c.cmd === 'hide_window'));
  assert.ok(calls.findIndex((c) => c.cmd === 'copy_to_clipboard') < calls.findIndex((c) => c.cmd === 'hide_window'));
});

test('rich text copy sends both html and text flavours', async () => {
  const { doc, calls, win } = await load('index.html');
  doc.querySelector('.history-item[data-id="4"]').click();
  await tick(win);
  const { content } = calls.find((c) => c.cmd === 'copy_to_clipboard').args;
  assert.ok(content.html.includes('<p'));
  assert.ok(typeof content.text === 'string' && content.text.length > 0);
});

test('Escape hides the popup; ArrowUp from the first row returns to search', async () => {
  const { doc, win, calls } = await load('index.html');
  key(win, doc, 'ArrowDown');
  key(win, doc, 'ArrowUp');
  assert.equal(doc.querySelector('.history-item.selected'), null);
  key(win, doc, 'Escape');
  assert.ok(calls.some((c) => c.cmd === 'hide_window'));
});

test('pin toggles via backend; pinned items resist delete', async () => {
  const { doc, win, calls } = await load('index.html');
  doc.querySelector('.history-item[data-id="1"] .pin-btn').click();
  await tick(win);
  assert.ok(calls.some((c) => c.cmd === 'pin_item' && c.args.id === '1'));
  assert.ok(doc.querySelector('.history-item[data-id="1"]').classList.contains('pinned'));
  doc.querySelector('.history-item[data-id="3"] .delete-btn').click();
  await tick(win);
  assert.ok(!calls.some((c) => c.cmd === 'delete_item' && c.args.id === '3'), 'pinned delete is blocked client-side');
  doc.querySelector('.history-item[data-id="2"] .delete-btn').click();
  await tick(win);
  assert.equal(doc.querySelector('.history-item[data-id="2"]'), null);
});

test('history-updated event re-renders', async () => {
  const ui = await load('index.html');
  ui.emit('history-updated', [{ id: '9', timestamp: Date.now(), type: 'text', content: 'fresh', preview: 'fresh', pinned: false, tags: [] }]);
  assert.deepEqual(texts(ui.doc), ['fresh']);
});

test('empty history shows the empty state', async () => {
  const { doc } = await load('index.html', { history: [] });
  assert.ok(doc.getElementById('emptyState').classList.contains('visible'));
});

test('tag dialog: add and remove a tag, Escape closes it', async () => {
  const { doc, win, calls } = await load('index.html');
  doc.querySelector('.history-item[data-id="3"] .tag-btn').click();
  await tick(win, 40);
  assert.ok(doc.getElementById('tagDialog'));
  doc.getElementById('tagInput').value = 'work';
  doc.getElementById('addTagBtn').click();
  await tick(win);
  assert.ok(calls.some((c) => c.cmd === 'add_tag_to_item' && c.args.tag === 'work'));
  assert.equal(doc.querySelector('#currentTagList .tag-item').textContent.replace('×', '').trim(), 'work');
  doc.querySelector('.remove-tag').click();
  await tick(win);
  assert.ok(calls.some((c) => c.cmd === 'remove_tag_from_item'));
  key(win, doc, 'Escape');
  assert.equal(doc.getElementById('tagDialog'), null);
});

test('maximise button sits before the settings button', async () => {
  const { doc } = await load('index.html');
  const actions = doc.querySelector('.header-actions');
  assert.deepEqual([...actions.children].map((b) => b.id), ['expandBtn', 'settingsBtn']);
});

test('maximise opens the big window on the current tab; settings opens General', async () => {
  const { doc, win, calls } = await load('index.html');
  doc.getElementById('expandBtn').click();
  await tick(win);
  assert.deepEqual(calls.filter((c) => c.cmd === 'show_settings').at(-1).args, { section: 'clipboard/all' });
  doc.querySelector('.filter-tab[data-filter="pinned"]').click();
  doc.getElementById('expandBtn').click();
  await tick(win);
  assert.deepEqual(calls.filter((c) => c.cmd === 'show_settings').at(-1).args, { section: 'clipboard/pinned' });
  doc.getElementById('settingsBtn').click();
  await tick(win);
  assert.deepEqual(calls.filter((c) => c.cmd === 'show_settings').at(-1).args, { section: null });
});

test('copying an image item sends the image itself, not base64 text', async () => {
  const { doc, win, calls } = await load('index.html');
  doc.querySelector('.history-item[data-id="5"]').click();
  await tick(win);
  const { content } = calls.find((c) => c.cmd === 'copy_to_clipboard').args;
  assert.deepEqual(Object.keys(content), ['image']);
  assert.ok(content.image.startsWith('data:image/png;base64,'));
});

test('macOS popup/sidebar tints are never fully transparent (text must stay readable over any vibrancy)', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'css', 'theme.css'), 'utf8');
  const mac = [...css.matchAll(/:root\[data-platform="macos"\](?:\[data-theme="dark"\])?\s*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
  assert.match(mac, /--panel-bg:\s*rgba\(/);
  assert.doesNotMatch(mac, /--(panel|sidebar)-bg:\s*transparent/);
  const alphas = [...mac.matchAll(/--(?:panel|sidebar)-bg:\s*rgba\([^)]*,\s*([0-9.]+)\)/g)].map((m) => Number(m[1]));
  assert.equal(alphas.length, 4); // panel + sidebar, light + dark
  assert.ok(alphas.every((a) => a >= 0.7), 'tint must be dense enough to guarantee contrast');
});
