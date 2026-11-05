const test = require('node:test');
const assert = require('node:assert/strict');
const { load, tick } = require('./harness');

const AVAILABLE = { available: true, version: '2.0.0', releaseNotes: 'x', releaseDate: '2026-01-01', downloadUrl: 'https://github.com/rrajendran/clyp/releases/download/v2.0.0/Clyp.dmg' };
const click = async (ui) => { ui.doc.getElementById('checkUpdatesBtn').click(); await tick(ui.win, 40); };
const toast = (ui) => (ui.doc.querySelector('.toast') || {}).textContent || '';
const names = (ui) => ui.calls.map((c) => c.cmd);

test('up to date: says so, never asks to download', async () => {
  const ui = await load('settings.html', { handlers: { check_for_updates: async () => ({ available: false }) } });
  await click(ui);
  assert.ok(names(ui).includes('check_for_updates'));
  assert.ok(!names(ui).includes('dialog.confirm'));
  assert.ok(!names(ui).includes('download_update'));
  assert.match(toast(ui), /up to date/i);
});

test('update available + user accepts: version is shown, download starts', async () => {
  const ui = await load('settings.html', { handlers: { check_for_updates: async () => AVAILABLE, download_update: async () => ({ success: true }) } });
  await click(ui);
  const ask = ui.calls.find((c) => c.cmd === 'dialog.confirm');
  assert.ok(ask.args.message.includes('2.0.0'), 'dialog names the new version');
  assert.ok(names(ui).includes('download_update'));
  assert.match(toast(ui), /Opening download/);
});

test('update available + user declines: nothing is downloaded', async () => {
  const ui = await load('settings.html', { confirm: false, handlers: { check_for_updates: async () => AVAILABLE } });
  await click(ui);
  assert.ok(names(ui).includes('dialog.confirm'));
  assert.ok(!names(ui).includes('download_update'));
});

test('check failure: error toast and the button works again', async () => {
  const ui = await load('settings.html', { handlers: { check_for_updates: async () => { throw 'GitHub rate limit reached. Try again in a few minutes.'; } } });
  await click(ui);
  assert.match(toast(ui), /Update check failed: GitHub rate limit reached/);
  const btn = ui.doc.getElementById('checkUpdatesBtn');
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Check for Updates');
  assert.ok(!names(ui).includes('download_update'));
});

test('download failure: reports the reason', async () => {
  const ui = await load('settings.html', { handlers: { check_for_updates: async () => AVAILABLE, download_update: async () => ({ success: false, error: 'No update available' }) } });
  await click(ui);
  assert.match(toast(ui), /Download failed: No update available/);
});

test('button shows progress and is disabled while a check is running', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ui = await load('settings.html', { handlers: { check_for_updates: () => gate } });
  ui.doc.getElementById('checkUpdatesBtn').click();
  await tick(ui.win);
  const btn = ui.doc.getElementById('checkUpdatesBtn');
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Checking…');
  ui.doc.getElementById('checkUpdatesBtn').click(); // a second click is ignored while disabled
  release({ available: false });
  await tick(ui.win, 40);
  assert.equal(names(ui).filter((n) => n === 'check_for_updates').length, 1);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Check for Updates');
});

test('About page shows the running version that the check compares against', async () => {
  const ui = await load('settings.html', { handlers: { get_app_version: async () => '1.0.3' } });
  assert.equal(ui.doc.querySelector('.about-content .version').textContent, 'Version 1.0.3');
});
