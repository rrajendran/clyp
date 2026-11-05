const test = require('node:test');
const assert = require('node:assert/strict');
const { load, tick, key } = require('./harness');

const updates = (calls) => calls.filter((c) => c.cmd === 'update_settings').map((c) => c.args.settings);

test('populates controls from settings and shows version', async () => {
  const { doc } = await load('settings.html', { settings: { startOnBoot: true, maxHistorySize: 250, captureFiles: true, theme: 'dark' } });
  assert.equal(doc.getElementById('startOnBoot').checked, true);
  assert.equal(doc.getElementById('maxHistorySize').value, '250');
  assert.equal(doc.getElementById('captureFiles').checked, true);
  assert.equal(doc.getElementById('autoDeleteDays').disabled, true, 'days disabled until auto-delete is on');
  assert.equal(doc.querySelector('.about-content .version').textContent, 'Version 9.9.9');
});

test('theme picker: Light / Dark / System persist and apply immediately', async () => {
  const { doc, win, calls } = await load('settings.html');
  const pick = (v) => doc.querySelector(`.theme-option[data-appearance="${v}"]`);
  assert.equal(pick('system').getAttribute('aria-checked'), 'true');
  pick('dark').click();
  await tick(win);
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.deepEqual(updates(calls).at(-1), { theme: 'dark' });
  assert.equal(pick('dark').getAttribute('aria-checked'), 'true');
  assert.equal(pick('system').getAttribute('aria-checked'), 'false');
  pick('light').click();
  assert.equal(doc.documentElement.dataset.theme, 'light');
  pick('system').click();
  assert.equal(doc.documentElement.dataset.appearance, 'system');
  assert.deepEqual(updates(calls).map((u) => u.theme), ['dark', 'light', 'system']);
});

test('theme picker supports arrow-key navigation (radio group)', async () => {
  const { doc, win } = await load('settings.html');
  const system = doc.querySelector('.theme-option[data-appearance="system"]');
  key(win, system, 'ArrowLeft');
  assert.equal(doc.documentElement.dataset.appearance, 'dark');
});

test('toggles save through update_settings', async () => {
  const { doc, win, calls } = await load('settings.html');
  const cb = doc.getElementById('captureFiles');
  cb.checked = true;
  cb.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick(win);
  assert.deepEqual(updates(calls).at(-1), { captureFiles: true });
});

test('auto-delete toggle enables the days field', async () => {
  const { doc, win } = await load('settings.html');
  const cb = doc.getElementById('autoDeleteHistory');
  cb.checked = true;
  cb.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick(win);
  assert.equal(doc.getElementById('autoDeleteDays').disabled, false);
});

test('number inputs are clamped to their declared range', async () => {
  const { doc, win, calls } = await load('settings.html');
  const el = doc.getElementById('maxHistorySize');
  el.value = '999999';
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick(win);
  assert.equal(el.value, '1000');
  assert.deepEqual(updates(calls).at(-1), { maxHistorySize: 1000 });
  el.value = '-5';
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick(win);
  assert.equal(el.value, '10');
});

test('sidebar switches settings pages and updates the title', async () => {
  const { doc } = await load('settings.html');
  doc.querySelector('.sidebar-item[data-target="privacy"]').click();
  assert.ok(doc.getElementById('privacy').classList.contains('active'));
  assert.ok(!doc.getElementById('general').classList.contains('active'));
  assert.ok(doc.querySelector('.sidebar-item[data-target="privacy"]').classList.contains('active'));
  assert.equal(doc.getElementById('topbarTitle').textContent, 'Privacy');
  assert.equal(doc.getElementById('topbarGroup').textContent, 'Settings');
});

test('shortcut recorder captures a combo and saves it (macOS glyphs)', async () => {
  const { doc, win, calls } = await load('settings.html', { platform: 'MacIntel' });
  const field = doc.getElementById('shortcut');
  assert.equal(field.value, '⌘⇧V');
  field.click();
  assert.equal(field.value, 'Press keys…');
  key(win, field, 'k', { code: 'KeyK', metaKey: true, altKey: true });
  assert.equal(field.value, '⌘⌥K');
  field.dispatchEvent(new win.KeyboardEvent('keyup', { key: 'k', bubbles: true, cancelable: true }));
  await tick(win);
  assert.deepEqual(updates(calls).at(-1), { shortcut: 'Command+Alt+K' });
});

test('shortcut recorder: Windows uses Ctrl, modifiers-only is rejected, Esc cancels', async () => {
  const { doc, win, calls } = await load('settings.html', { platform: 'Win32', settings: { shortcut: 'Control+Shift+V' } });
  const field = doc.getElementById('shortcut');
  assert.equal(field.value, 'Ctrl+Shift+V');
  field.click();
  key(win, field, 'Control', { code: 'ControlLeft', ctrlKey: true });
  field.dispatchEvent(new win.KeyboardEvent('keyup', { key: 'Control', bubbles: true, cancelable: true }));
  await tick(win);
  assert.equal(updates(calls).length, 0, 'modifier-only combo not saved');
  key(win, field, 'Escape', { code: 'Escape' });
  assert.equal(field.value, 'Ctrl+Shift+V', 'restored after cancel');
});

test('macOS-only rows exist (hidden by CSS elsewhere)', async () => {
  const { doc } = await load('settings.html');
  assert.ok(doc.querySelector('.mac-only #hideDockIcon'));
});

test('clear history confirms first, then calls the backend', async () => {
  const { doc, win, calls } = await load('settings.html');
  doc.getElementById('clearAllData').click();
  await tick(win, 40);
  assert.ok(calls.some((c) => c.cmd === 'clear_history'));
});

test('external links go through open_external', async () => {
  const { doc, calls } = await load('settings.html');
  doc.querySelector('[data-link]').click();
  assert.ok(calls.some((c) => c.cmd === 'open_external' && c.args.url.startsWith('https://github.com/')));
});
