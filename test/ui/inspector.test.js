const test = require('node:test');
const assert = require('node:assert/strict');
const { load, tick, key, sampleHistory } = require('./harness');

const BIG = 'First line\n' + 'middle line\n'.repeat(12) + '<img src=x onerror="alert(1)"> last line';
const withBig = () => [...sampleHistory(), { id: '7', timestamp: Date.now() - 500, type: 'text', content: BIG, preview: 'First line', pinned: false, tags: ['work'] }];
const open = (ui) => ui.doc.getElementById('inspector').dataset.open === 'true';
const row = (ui, id) => ui.doc.querySelector(`#historyList .history-item[data-id="${id}"]`);
const copies = (ui) => ui.calls.filter((c) => c.cmd === 'copy_to_clipboard');
const go = (opts = {}) => load('settings.html', { query: '?go=clipboard/all', history: withBig(), ...opts });

test('clicking long text opens the inspector with the full text (and does not copy)', async () => {
  const ui = await go();
  assert.equal(open(ui), false);
  row(ui, '7').click();
  await tick(ui.win);
  assert.equal(open(ui), true);
  assert.equal(ui.doc.getElementById('inspector').getAttribute('aria-hidden'), 'false');
  assert.equal(ui.doc.querySelector('#inspectorBody pre').textContent, BIG, 'the whole text, untruncated');
  assert.equal(copies(ui).length, 0, 'inspecting is not copying');
  assert.ok(row(ui, '7').classList.contains('inspected'));
});

test('clicking an image opens the inspector with the full image', async () => {
  const ui = await go();
  row(ui, '5').click();
  const img = ui.doc.querySelector('#inspectorBody img');
  assert.ok(open(ui));
  assert.ok(img.getAttribute('src').startsWith('data:image/png;base64,'));
  assert.equal(ui.doc.getElementById('inspectorType').textContent, 'Image');
  assert.match(ui.doc.getElementById('inspectorSub').textContent, /^640 × 480 · /);
  assert.equal(copies(ui).length, 0);
});

test('clicking short text still copies and does not open the pane', async () => {
  const ui = await go();
  row(ui, '2').click();
  await tick(ui.win);
  assert.equal(copies(ui).length, 1);
  assert.equal(open(ui), false);
});

test('text summary shows characters and lines', async () => {
  const ui = await go();
  row(ui, '7').click();
  const lines = BIG.split('\n').length;
  assert.equal(ui.doc.getElementById('inspectorType').textContent, 'Text');
  assert.equal(ui.doc.getElementById('inspectorSub').textContent, `${BIG.length.toLocaleString()} characters · ${lines} lines`);
  assert.equal(ui.doc.querySelector('#inspectorTags .tag').textContent, 'work');
  assert.ok(ui.doc.getElementById('inspectorWhen').textContent.length > 0);
});

test('there is no "View full" button or cue anywhere in the big window', async () => {
  const ui = await go();
  assert.equal(ui.doc.body.textContent.includes('View full'), false);
  const fs = require('fs'), path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'css', 'settings.css'), 'utf8');
  assert.equal(/View full/.test(css), false, 'no CSS-generated cue either');
  assert.equal(ui.doc.querySelector('#historyList .lengthy'), null);
  assert.equal(ui.doc.getElementById('textDrawer'), null, 'old full-content sheet is gone from this window');
  assert.ok(row(ui, '7').querySelector('.item-content.inspectable'), 'long items are marked inspectable instead');
});

test('the popup keeps its own long-text sheet', async () => {
  const ui = await load('index.html', { history: withBig() });
  assert.ok(ui.doc.querySelector('.history-item[data-id="7"] .item-content.lengthy'));
  assert.equal(ui.doc.getElementById('inspector'), null);
});

test('inspector Copy copies the full text, keeps the clipboard, and toasts', async () => {
  const ui = await go();
  row(ui, '7').click();
  ui.doc.getElementById('inspectorCopy').click();
  await tick(ui.win);
  const c = copies(ui)[0].args;
  assert.deepEqual(c.content, { text: BIG });
  assert.equal(c.keep, true);
  assert.match(ui.doc.querySelector('.toast').textContent, /Copied/);
  assert.equal(open(ui), true, 'pane stays open after copying');
});

test('inspector Copy sends a real image for images', async () => {
  const ui = await go();
  row(ui, '5').click();
  ui.doc.getElementById('inspectorCopy').click();
  await tick(ui.win);
  assert.deepEqual(Object.keys(copies(ui)[0].args.content), ['image']);
});

test('row copy button copies long items without opening the pane', async () => {
  const ui = await go();
  row(ui, '7').querySelector('.copy-btn').click();
  await tick(ui.win);
  assert.deepEqual(copies(ui)[0].args.content, { text: BIG });
  assert.equal(open(ui), false);
});

test('Esc and the close button dismiss the pane; Esc does not hide anything', async () => {
  const ui = await go();
  row(ui, '7').click();
  key(ui.win, ui.doc, 'Escape');
  assert.equal(open(ui), false);
  assert.equal(ui.doc.querySelector('#inspectorBody').children.length, 0, 'content released');
  assert.equal(row(ui, '7').classList.contains('inspected'), false);
  row(ui, '5').click();
  ui.doc.getElementById('inspectorClose').click();
  assert.equal(open(ui), false);
  assert.ok(!ui.calls.some((c) => c.cmd === 'hide_window'));
});

test('keyboard: Enter inspects long/image rows and copies short rows', async () => {
  const ui = await go();
  const items = [...ui.doc.querySelectorAll('#historyList .history-item')].map((e) => e.dataset.id);
  const press = (id) => { // select row `id` via arrows from the top, then Enter
    ui.doc.getElementById('searchInput').focus();
    for (let i = 0; i <= items.indexOf(id); i++) key(ui.win, ui.doc, 'ArrowDown');
    key(ui.win, ui.doc, 'Enter');
  };
  press('7');
  assert.equal(open(ui), true);
  assert.equal(copies(ui).length, 0);
  ui.doc.getElementById('inspectorClose').click();
  // from a fresh selection state move to a short item
  const shortId = items.find((id) => id === '2');
  while (ui.doc.querySelector('.history-item.selected')?.dataset.id !== shortId) key(ui.win, ui.doc, ui.doc.querySelector('.history-item.selected') && items.indexOf(ui.doc.querySelector('.history-item.selected').dataset.id) > items.indexOf(shortId) ? 'ArrowUp' : 'ArrowDown');
  key(ui.win, ui.doc, 'Enter');
  await tick(ui.win);
  assert.equal(copies(ui).length, 1);
});

test('with the pane open, arrow keys preview the next long/image item', async () => {
  const ui = await go();
  row(ui, '7').click();
  const order = [...ui.doc.querySelectorAll('#historyList .history-item')].map((e) => e.dataset.id);
  const at = order.indexOf('7');
  const next = order.slice(at + 1).find((id) => ['5', '6'].includes(id));
  assert.ok(next, 'test data has another inspectable row below');
  for (let i = at; i < order.indexOf(next); i++) key(ui.win, ui.doc, 'ArrowDown');
  assert.equal(row(ui, next).classList.contains('inspected'), true);
  assert.equal(row(ui, '7').classList.contains('inspected'), false);
});

test('pin / unpin from the pane updates the list and the button; pinned cannot be deleted', async () => {
  const ui = await go();
  row(ui, '7').click();
  const pin = ui.doc.getElementById('inspectorPin'), del = ui.doc.getElementById('inspectorDelete');
  assert.equal(pin.textContent, 'Pin');
  assert.equal(del.disabled, false);
  pin.click();
  await tick(ui.win);
  assert.ok(ui.calls.some((c) => c.cmd === 'pin_item' && c.args.id === '7'));
  assert.equal(pin.textContent, 'Unpin');
  assert.equal(del.disabled, true, 'delete is disabled while pinned');
  assert.ok(row(ui, '7').classList.contains('pinned'));
  assert.equal(open(ui), true);
});

test('Delete from the pane removes the item and closes the pane', async () => {
  const ui = await go();
  row(ui, '7').click();
  ui.doc.getElementById('inspectorDelete').click();
  await tick(ui.win);
  assert.ok(ui.calls.some((c) => c.cmd === 'delete_item' && c.args.id === '7'));
  assert.equal(open(ui), false);
  assert.equal(row(ui, '7'), null);
});

test('pane follows backend updates: closes if the item vanishes, refreshes if it changes', async () => {
  const ui = await go();
  row(ui, '7').click();
  const body = ui.doc.getElementById('inspectorBody');
  const pre = body.querySelector('pre');
  // pin state changes but content does not -> same DOM node (scroll position kept)
  ui.emit('history-updated', withBig().map((h) => (h.id === '7' ? { ...h, pinned: true } : h)));
  assert.equal(body.querySelector('pre'), pre);
  assert.equal(ui.doc.getElementById('inspectorPin').textContent, 'Unpin');
  // content changes -> re-rendered
  ui.emit('history-updated', withBig().map((h) => (h.id === '7' ? { ...h, content: BIG + ' EDITED' } : h)));
  assert.ok(body.querySelector('pre').textContent.endsWith('EDITED'));
  // item gone -> closed
  ui.emit('history-updated', sampleHistory());
  assert.equal(open(ui), false);
});

test('the pane stays usable while searching and shows the item even if it is filtered out', async () => {
  const ui = await go();
  row(ui, '7').click();
  const input = ui.doc.getElementById('searchInput');
  input.value = 'zzzz-no-match';
  input.dispatchEvent(new ui.win.Event('input', { bubbles: true }));
  assert.equal(open(ui), true);
  assert.equal(ui.doc.querySelector('#inspectorBody pre').textContent, BIG);
});

test('switching to a settings page closes the pane', async () => {
  const ui = await go();
  row(ui, '7').click();
  ui.doc.querySelector('.sidebar-item[data-target="general"]').click();
  assert.equal(open(ui), false);
  ui.doc.querySelector('.sidebar-item[data-target="clipboard/all"]').click();
  assert.equal(open(ui), false, 'does not reappear by itself');
});

test('copied content is rendered as text, never as markup', async () => {
  const ui = await go();
  row(ui, '7').click();
  assert.equal(ui.doc.querySelector('#inspectorBody img'), null);
  assert.equal(ui.doc.querySelector('#inspectorBody [onerror]'), null);
  assert.ok(ui.doc.querySelector('#inspectorBody pre').textContent.includes('<img src=x onerror='));
});

test('rich text long enough to inspect shows formatted source', async () => {
  const html = '<div>' + '<p>paragraph</p>'.repeat(30) + '</div>';
  const ui = await go({ history: [{ id: '9', timestamp: Date.now(), type: 'html', content: html, preview: 'paragraph', pinned: false, tags: [] }] });
  row(ui, '9').click();
  assert.equal(ui.doc.getElementById('inspectorType').textContent, 'Rich Text');
  assert.ok(ui.doc.querySelector('#inspectorBody pre').textContent.includes('<p>'));
});
