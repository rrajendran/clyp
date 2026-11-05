// Clyp – history popup (renderer)

let history = [];
let filteredHistory = [];
let selectedIndex = -1;
let currentFilter = 'all';
let searchQuery = '';
let inspectedId = null;   // item shown in the inspector pane (big window only)
let inspectorKey = '';    // what is currently rendered there, to avoid needless re-renders

// The same list code runs in two places:
//   popup     – the compact launcher window (index.html)
//   workspace – the Clipboard pages of the big window (settings.html)
const IS_POPUP = document.body.dataset.mode !== 'workspace';

document.addEventListener('DOMContentLoaded', async () => {
  setupListListeners();
  await loadHistory();
  if (IS_POPUP) focusSearch();
  applyTheme();
});

// The popup is a long-lived hidden window: when it is shown again, start
// fresh like a launcher – latest history, empty query, nothing selected.
if (IS_POPUP) window.addEventListener('focus', async () => {
  const input = document.getElementById('searchInput');
  if (document.getElementById('tagDialog')) return;
  searchQuery = '';
  input.value = '';
  selectedIndex = -1;
  closeTextDrawer();
  await loadHistory();
  document.querySelector('.history-container').scrollTop = 0;
  focusSearch();
});

window.clyp.onHistoryUpdated((newHistory) => {
  history = newHistory;
  applyFilters();
  renderHistory();
});

window.clyp.onSettingsChanged((newSettings) => applyTheme(newSettings));

// Format HTML or XML source for nicer clipboard output. Uses DOMParser to
// build a DOM and then serializes it with indentation. Falls back to a
// conservative whitespace-preserving output when parsing fails.
function formatHtmlOrXml(source) {
  if (!source || typeof source !== 'string') return source || '';

  // Helper to serialize a Node with indentation
  function serialize(node, indent) {
    const IND = '  ';
    let out = '';
    const pad = IND.repeat(indent);

    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.nodeValue.replace(/\s+/g, ' ');
      if (txt.trim() === '') return '';
      return pad + txt.trim() + '\n';
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return pad + '<!--' + node.nodeValue + '-->\n';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    out += pad + '<' + node.tagName.toLowerCase();
    // attributes
    if (node.attributes && node.attributes.length) {
      for (let i = 0; i < node.attributes.length; i++) {
        const a = node.attributes[i];
        out += ' ' + a.name + '="' + a.value + '"';
      }
    }

    const children = Array.from(node.childNodes || []);
    if (children.length === 0) {
      out += ' />\n';
      return out;
    }

    out += '>\n';
    for (const c of children) {
      out += serialize(c, indent + 1);
    }
    out += pad + '</' + node.tagName.toLowerCase() + '>\n';
    return out;
  }

  try {
    // Try XML parsing first (for well-formed XML snippets)
    const xmlParser = new DOMParser();
    const xmlDoc = xmlParser.parseFromString(source, 'application/xml');
    if (xmlDoc && !xmlDoc.getElementsByTagName('parsererror').length) {
      // Serialize root children
      let result = '';
      const children = Array.from(xmlDoc.childNodes || []);
      for (const c of children) {
        result += serialize(c, 0);
      }
      return result.trim();
    }

    // Fall back to HTML parsing
    const htmlDoc = xmlParser.parseFromString(source, 'text/html');
    const body = htmlDoc.body;
    if (body) {
      // If the source is a full document (has head, html), prefer those nodes
      const htmlEl = htmlDoc.querySelector('html');
      if (htmlEl) {
        return serialize(htmlEl, 0).trim();
      }
      // Otherwise serialize body children
      let result = '';
      for (const c of Array.from(body.childNodes || [])) {
        result += serialize(c, 0);
      }
      return result.trim();
    }
  } catch (e) {
    // parsing failed — fall through
  }

  // Fallback: return original source, trimmed
  return source.trim();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadHistory() {
  history = await window.clyp.getHistory();
  applyFilters();
  renderHistory();
}

async function applyTheme(prefetched) {
  const settings = prefetched || await window.clyp.getSettings();
  window.clyp.applyAppearance(settings.theme);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function setupListListeners() {
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    selectedIndex = -1;
    applyFilters();
    renderHistory();
  });

  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      filterTabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      currentFilter = tab.dataset.filter;
      selectedIndex = -1;
      applyFilters();
      renderHistory();
      focusSearch();
    });
  });

  document.getElementById('settingsBtn')?.addEventListener('click', () => window.clyp.showSettings());
  // Maximise: open the big window on the Clipboard page matching the current tab.
  document.getElementById('expandBtn')?.addEventListener('click', () => {
    window.clyp.showSettings(`clipboard/${currentFilter}`);
  });

  // Popup: full-content sheet. (The big window uses the inspector pane.)
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeTextDrawer);
  document.getElementById('drawerOverlay')?.addEventListener('click', closeTextDrawer);
  document.getElementById('copyDrawerBtn')?.addEventListener('click', copyDrawerContent);

  // Big window: inspector pane controls.
  document.getElementById('inspectorClose')?.addEventListener('click', closeInspector);
  document.getElementById('inspectorCopy')?.addEventListener('click', () => {
    const item = history.find((h) => h.id === inspectedId);
    if (item) copyItemObject(item);
  });
  document.getElementById('inspectorPin')?.addEventListener('click', () => { if (inspectedId) togglePin(inspectedId); });
  document.getElementById('inspectorDelete')?.addEventListener('click', () => { if (inspectedId) deleteItem(inspectedId); });

  document.addEventListener('keydown', handleKeyPress);

  // Copying a selection inside a rendered HTML item should put the *original*
  // markup on the clipboard, not the sanitised preview DOM.
  document.addEventListener('copy', async (e) => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.anchorNode) return;
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const itemEl = el && el.closest ? el.closest('.history-item') : null;
      if (!itemEl) return;
      const item = history.find((h) => h.id === itemEl.dataset.id);
      if (item && item.type === 'html') {
        e.preventDefault();
        await window.clyp.copyToClipboard({ html: item.content || '', text: formatHtmlOrXml(item.content || '') }, !IS_POPUP);
        showToast('Copied', 'success');
      }
    } catch (err) {
      console.error('copy handler failed:', err);
    }
  });
}

function handleKeyPress(e) {
  const searchInput = document.getElementById('searchInput');
  const tagDialog = document.getElementById('tagDialog');

  if (e.key === 'Escape') {
    if (tagDialog) tagDialog.remove();
    else if (document.getElementById('textDrawer')?.classList.contains('open')) closeTextDrawer();
    else if (inspectedId) closeInspector();
    else if (IS_POPUP) window.clyp.hideWindow();
    return;
  }
  if (tagDialog) return; // dialog owns the keyboard

  if (!IS_POPUP) {
    // In the big window only drive the list while a Clipboard page is showing
    // and the user is not typing in a settings field.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target !== searchInput;
    if (typing || !document.getElementById('clipboard').classList.contains('active')) return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < filteredHistory.length - 1) {
      selectedIndex++;
      updateSelection();
      followSelectionInInspector();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex > 0) {
      selectedIndex--;
      updateSelection();
      followSelectionInInspector();
    } else if (selectedIndex === 0) {
      selectedIndex = -1;
      updateSelection();
      focusSearch();
    }
  } else if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault();
    activateItem(selectedIndex);
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    if (window.getSelection().toString()) return; // let the copy event handle it
    if (selectedIndex >= 0) {
      e.preventDefault();
      copyItem(selectedIndex);
    }
  } else if (IS_POPUP && e.key.length === 1 && !e.metaKey && !e.ctrlKey && document.activeElement !== searchInput) {
    focusSearch();
  }
}

function updateSelection() {
  document.querySelectorAll('.history-item').forEach((el, index) => {
    const selected = index === selectedIndex;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-selected', String(selected));
    if (selected) el.scrollIntoView({ block: 'nearest' });
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function applyFilters() {
  filteredHistory = history.filter((item) => {
    if (currentFilter === 'pinned' && !item.pinned) return false;
    if (currentFilter === 'text' && item.type !== 'text' && item.type !== 'html') return false;
    if (currentFilter === 'image' && item.type !== 'image') return false;

    if (searchQuery) {
      const haystack = item.type === 'image' ? '' : (item.preview || item.content || '').toLowerCase();
      const tags = (item.tags || []).join(' ').toLowerCase();
      if (!haystack.includes(searchQuery) && !tags.includes(searchQuery)) return false;
    }
    return true;
  });

  // Pinned first, then newest first.
  filteredHistory.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.timestamp - a.timestamp));
}

function updateCounts() {
  const counts = {
    all: history.length,
    text: history.filter((i) => i.type === 'text' || i.type === 'html').length,
    image: history.filter((i) => i.type === 'image').length,
    pinned: history.filter((i) => i.pinned).length,
  };
  document.querySelectorAll('[data-count]').forEach((el) => {
    const n = counts[el.dataset.count];
    el.textContent = n ? String(n) : '';
  });
}

function renderHistory() {
  updateCounts();
  refreshInspector();
  const list = document.getElementById('historyList');
  const empty = document.getElementById('emptyState');

  if (filteredHistory.length === 0) {
    list.innerHTML = '';
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  list.innerHTML = filteredHistory.map(createHistoryItemHTML).join('');
  attachItemEventListeners();
}

const ICONS = {
  text: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
  html: '<svg class="icon" viewBox="0 0 24 24"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
  image: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  file: '<svg class="icon" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
  tag: '<svg class="icon" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
};

const TYPE_LABELS = { text: 'Text', html: 'Rich Text', image: 'Image', file: 'File', video: 'Video' };

function createHistoryItemHTML(item, index) {
  const selected = index === selectedIndex;
  const tagsHTML = item.tags && item.tags.length
    ? `<div class="item-tags">${item.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '<span></span>';
  // Popup: long text gets a "View full" badge and opens a sheet.
  // Big window: long text and images open the inspector pane instead (no badge).
  const lengthy = IS_POPUP && item.type !== 'image' && isLengthyContent(item.content);
  const inspectable = !IS_POPUP && isInspectable(item);

  return `
    <div class="history-item ${selected ? 'selected' : ''} ${item.pinned ? 'pinned' : ''} ${item.id === inspectedId ? 'inspected' : ''}" role="option" aria-selected="${selected}" data-index="${index}" data-id="${escapeHtml(item.id)}">
      <div class="item-header">
        <div class="item-type">${ICONS[item.type] || ICONS.text}<span>${TYPE_LABELS[item.type] || escapeHtml(item.type)}</span></div>
        <div class="item-actions">
          ${IS_POPUP ? '' : `<button class="action-btn copy-btn" data-action="copy" title="Copy" aria-label="Copy">${ICONS.copy}</button>`}
          <button class="action-btn pin-btn ${item.pinned ? 'pinned' : ''}" data-action="pin" title="${item.pinned ? 'Unpin' : 'Pin'}" aria-label="${item.pinned ? 'Unpin' : 'Pin'}">${ICONS.pin}</button>
          ${item.pinned ? `<button class="action-btn tag-btn" data-action="tag" title="Manage Tags" aria-label="Manage Tags">${ICONS.tag}</button>` : ''}
          <button class="action-btn delete-btn" data-action="delete" title="Delete" aria-label="Delete">${ICONS.trash}</button>
        </div>
      </div>
      <div class="item-content ${escapeHtml(item.type)} ${lengthy ? 'lengthy' : ''} ${inspectable ? 'inspectable' : ''}">${getContentHTML(item)}</div>
      <div class="item-footer">
        ${tagsHTML}
        <span class="item-timestamp">${formatTimestamp(item.timestamp)}</span>
      </div>
    </div>`;
}

function getContentHTML(item) {
  if (item.type === 'image') {
    return `<img src="${escapeHtml(item.content)}" alt="Clipboard image">`;
  }
  if (item.type === 'html') {
    return `<div class="html-content">${sanitizeHtml(item.content || '')}</div>`;
  }
  return escapeHtml(item.preview || item.content || '');
}

function formatTimestamp(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function attachItemEventListeners() {
  document.querySelectorAll('.history-item').forEach((el) => {
    const id = el.dataset.id;

    el.addEventListener('click', async (e) => {
      if (e.target.closest('.action-btn')) return;
      const index = filteredHistory.findIndex((h) => h.id === id);
      if (IS_POPUP) {
        if (e.target.closest('.item-content.lengthy')) openTextDrawer(index);
        else await copyItem(index);
        return;
      }
      selectedIndex = index;
      updateSelection();
      await activateItem(index);
    });

    el.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = history.find((h) => h.id === id);
      if (item) copyItemObject(item);
    });

    el.querySelector('.pin-btn')?.addEventListener('click', (e) => { e.stopPropagation(); togglePin(id); });
    el.querySelector('.tag-btn')?.addEventListener('click', (e) => { e.stopPropagation(); showTagDialog(id); });
    el.querySelector('.delete-btn')?.addEventListener('click', (e) => { e.stopPropagation(); deleteItem(id); });
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function buildPayload(item) {
  if (item.type === 'html') {
    // Keep both flavours so rich targets get formatting and plain targets get
    // tidy, indented source.
    return { html: item.content || '', text: formatHtmlOrXml(item.content || '') };
  }
  if (item.type === 'image') return { image: item.content }; // a real image, not base64 text
  return { text: item.content };
}

async function copyItem(index) {
  const item = filteredHistory[index];
  if (item) await copyItemObject(item);
}

// Enter / click on a row. Popup: copy. Big window: long text and images open
// the inspector (copy is in the pane / row button / Cmd+C); short items copy.
async function activateItem(index) {
  const item = filteredHistory[index];
  if (!item) return;
  if (!IS_POPUP && isInspectable(item)) openInspector(item.id);
  else await copyItemObject(item);
}

async function copyItemObject(item) {
  const payload = buildPayload(item);
  try {
    await window.clyp.copyToClipboard(payload, !IS_POPUP);
    if (IS_POPUP) await window.clyp.hideWindow();
    else showToast('Copied', 'success');
  } catch (err) {
    showToast('Could not copy', 'error');
    console.error(err);
  }
}

async function togglePin(id) {
  history = await window.clyp.pinItem(id);
  applyFilters();
  renderHistory();
}

async function deleteItem(id) {
  const item = history.find((h) => h.id === id);
  if (item && item.pinned) {
    // Pinned items are protected: nudge instead of deleting.
    const el = document.querySelector(`.history-item[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.style.animation = 'shake 0.3s';
      setTimeout(() => { el.style.animation = ''; }, 300);
    }
    return;
  }
  history = await window.clyp.deleteItem(id);
  applyFilters();
  renderHistory();
  if (selectedIndex >= filteredHistory.length) selectedIndex = filteredHistory.length - 1;
}

function focusSearch() {
  document.getElementById('searchInput').focus();
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Clipboard HTML comes from arbitrary apps and websites. Parse it inertly
// and keep only inert, presentational markup (the CSP also blocks scripts and
// remote loads, this is defence in depth).
const BLOCKED_TAGS = 'script,style,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,svg,math,audio,video,source,template,noscript';
function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll(BLOCKED_TAGS).forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc' ||
          ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && !/^(https?:|mailto:|#)/.test(value))) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') { el.removeAttribute('href'); el.removeAttribute('target'); } // previews are not navigable
  });
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function showTagDialog(itemId) {
  const item = history.find((i) => i.id === itemId);
  if (!item) return;

  const response = await window.clyp.getAllTags();
  const allTags = response.tags || [];
  const currentTags = [...(item.tags || [])];

  document.body.insertAdjacentHTML('beforeend', `
    <div id="tagDialog" class="tag-dialog-overlay">
      <div class="tag-dialog" role="dialog" aria-modal="true" aria-label="Manage Tags">
        <div class="tag-dialog-header">
          <h3>Manage Tags</h3>
          <button class="icon-btn tag-dialog-close" aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div class="tag-dialog-body">
          <div class="tag-input-container">
            <input type="text" id="tagInput" placeholder="Add a tag" autocomplete="off" spellcheck="false">
            <button class="btn" id="addTagBtn">Add</button>
          </div>
          <div class="current-tags">
            <h4>Tags</h4>
            <div class="tag-list" id="currentTagList"></div>
          </div>
        </div>
      </div>
    </div>`);

  const dialog = document.getElementById('tagDialog');
  const tagInput = document.getElementById('tagInput');
  const tagList = document.getElementById('currentTagList');

  const renderTags = () => {
    tagList.innerHTML = currentTags.map((tag) =>
      `<span class="tag-item">${escapeHtml(tag)}<button class="remove-tag" data-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">&times;</button></span>`
    ).join('');
  };
  const syncItem = () => {
    const live = history.find((i) => i.id === itemId);
    if (live) live.tags = [...currentTags];
    applyFilters();
    renderHistory();
  };
  renderTags();
  setupTagAutocomplete(tagInput, allTags);
  setTimeout(() => tagInput.focus(), 50);

  const addTag = async () => {
    const tag = tagInput.value.trim();
    if (!tag || currentTags.includes(tag)) return;
    try {
      const result = await window.clyp.addTagToItem(itemId, tag);
      if (result.success) {
        currentTags.push(tag);
        tagInput.value = '';
        renderTags();
        syncItem();
      }
    } catch (err) { console.error('Failed to add tag:', err); }
  };

  document.getElementById('addTagBtn').addEventListener('click', addTag);
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

  tagList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.remove-tag');
    if (!btn) return;
    const tag = btn.dataset.tag;
    try {
      const result = await window.clyp.removeTagFromItem(itemId, tag);
      if (result.success) {
        const i = currentTags.indexOf(tag);
        if (i > -1) currentTags.splice(i, 1);
        renderTags();
        syncItem();
      }
    } catch (err) { console.error('Failed to remove tag:', err); }
  });

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('.tag-dialog-close')) dialog.remove();
  });
}

function setupTagAutocomplete(input, allTags) {
  let suggestions = [];
  const box = document.createElement('div');
  box.className = 'tag-suggestions';
  box.style.display = 'none';
  input.parentNode.appendChild(box);

  const update = () => {
    const value = input.value.trim().toLowerCase();
    suggestions = allTags.filter((t) => !value || t.toLowerCase().startsWith(value)).slice(0, 5);
    box.style.display = suggestions.length ? 'block' : 'none';
    box.innerHTML = suggestions.map((t) => `<div class="tag-suggestion" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`).join('');
  };

  input.addEventListener('focus', update);
  input.addEventListener('input', update);
  input.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.tag-suggestion');
    if (!el) return;
    e.preventDefault();
    input.value = el.dataset.tag;
    box.style.display = 'none';
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// Toast + full-content sheet
// ---------------------------------------------------------------------------

function showToast(message, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2100);
}

function openTextDrawer(index) {
  const item = filteredHistory[index];
  if (!item) return;
  const content = item.type === 'html' ? formatHtmlOrXml(item.content || '') : (item.content || '');
  document.getElementById('drawerText').textContent = content;
  document.getElementById('textDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('active');
}

function closeTextDrawer() {
  document.getElementById('textDrawer')?.classList.remove('open');
  document.getElementById('drawerOverlay')?.classList.remove('active');
}

async function copyDrawerContent() {
  const content = document.getElementById('drawerText').textContent;
  if (!content) return;
  await window.clyp.copyToClipboard({ text: content }, !IS_POPUP);
  closeTextDrawer();
  if (IS_POPUP) await window.clyp.hideWindow();
  else showToast('Copied', 'success');
}

// ---------------------------------------------------------------------------
// Inspector pane (big window): full text or full image for the clicked item
// ---------------------------------------------------------------------------

// Images and long text are worth a closer look; short items just copy on click.
function isInspectable(item) {
  return item.type === 'image' || isLengthyContent(item.content);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function inspectorSummary(item) {
  const when = new Date(item.timestamp).toLocaleString();
  if (item.type === 'image') {
    const dims = item.size ? `${item.size.width} × ${item.size.height} · ` : '';
    // A data URL carries ~4 bytes of text per 3 bytes of image.
    const bytes = Math.round(((item.content || '').length - (item.content || '').indexOf(',') - 1) * 0.75);
    return { type: 'Image', metrics: `${dims}${formatBytes(Math.max(bytes, 0))}`, when };
  }
  const text = item.type === 'html' ? formatHtmlOrXml(item.content || '') : (item.content || '');
  const lines = text.split('\n').length;
  return {
    type: item.type === 'html' ? 'Rich Text' : (TYPE_LABELS[item.type] || 'Text'),
    metrics: `${text.length.toLocaleString()} characters · ${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`,
    when,
    text,
  };
}

function openInspector(id) {
  const item = history.find((h) => h.id === id);
  const pane = document.getElementById('inspector');
  if (!item || !pane) return;
  inspectedId = id;
  inspectorKey = '';
  renderInspector(item);
  pane.dataset.open = 'true';
  pane.setAttribute('aria-hidden', 'false');
  markInspectedRow();
}

function closeInspector() {
  const pane = document.getElementById('inspector');
  inspectedId = null;
  inspectorKey = '';
  if (pane) {
    pane.dataset.open = 'false';
    pane.setAttribute('aria-hidden', 'true');
    document.getElementById('inspectorBody').replaceChildren();
  }
  markInspectedRow();
}

function markInspectedRow() {
  document.querySelectorAll('.history-item').forEach((el) => el.classList.toggle('inspected', el.dataset.id === inspectedId));
}

// Content goes in via textContent / the img src property – never innerHTML –
// so whatever was copied cannot inject markup into the app.
function renderInspector(item) {
  const info = inspectorSummary(item);
  document.getElementById('inspectorType').textContent = info.type;
  document.getElementById('inspectorSub').textContent = info.metrics;
  document.getElementById('inspectorWhen').textContent = info.when;

  const tags = document.getElementById('inspectorTags');
  tags.replaceChildren(...(item.tags || []).map((t) => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = t;
    return span;
  }));

  const key = `${item.id}:${(item.content || '').length}`;
  if (key !== inspectorKey) { // keep scroll position when only pin/tags changed
    inspectorKey = key;
    const body = document.getElementById('inspectorBody');
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.alt = 'Clipboard image';
      img.src = item.content;
      body.replaceChildren(img);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = info.text;
      body.replaceChildren(pre);
    }
    body.scrollTop = 0;
  }

  const pin = document.getElementById('inspectorPin');
  pin.textContent = item.pinned ? 'Unpin' : 'Pin';
  const del = document.getElementById('inspectorDelete');
  del.disabled = !!item.pinned;
  del.title = item.pinned ? 'Unpin to delete' : 'Delete';
}

// Called whenever the history changes: keep the pane honest.
function refreshInspector() {
  if (!inspectedId) return;
  const item = history.find((h) => h.id === inspectedId);
  if (!item) closeInspector();     // deleted / trimmed away
  else renderInspector(item);      // pinned, tagged or edited
}

// With the pane open, moving the selection with the arrow keys previews the
// next item (like Quick Look). Short items leave the pane as it is.
function followSelectionInInspector() {
  if (IS_POPUP || !inspectedId) return;
  const item = filteredHistory[selectedIndex];
  if (item && isInspectable(item)) openInspector(item.id);
}

// More than 300 characters or 5 lines counts as "lengthy".
function isLengthyContent(content) {
  if (!content) return false;
  const lines = (content.match(/\n/g) || []).length + 1;
  return content.length > 300 || lines > 5;
}

// ---------------------------------------------------------------------------
// Hooks used by the workspace window (settings.js)
// ---------------------------------------------------------------------------

window.clypView = {
  closeInspector,
  setFilter(filter) {
    currentFilter = ['all', 'text', 'image', 'pinned'].includes(filter) ? filter : 'all';
    selectedIndex = -1;
    applyFilters();
    renderHistory();
  },
  focusSearch,
};
