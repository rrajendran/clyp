// Clyp Clipboard Manager - Renderer Process

let history = [];
let filteredHistory = [];
let selectedIndex = -1;
let currentFilter = 'all';
let searchQuery = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadHistory();
  setupEventListeners();
  focusSearch();
  applyTheme();
  setIconPaths();
});

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

// Set icon paths dynamically
async function setIconPaths() {
  try {
    const logoSrc = await window.electronAPI.getAssetPath('icons/png/32x32.png');
    const emptyStateSrc = await window.electronAPI.getAssetPath('icons/png/128x128.png');
    
    const logoElements = document.querySelectorAll('.logo');
    logoElements.forEach(el => {
      if (el.dataset.src) {
        el.src = logoSrc;
      }
    });
    
    const emptyStateImg = document.querySelector('#emptyState img');
    if (emptyStateImg && emptyStateImg.dataset.src) {
      emptyStateImg.src = emptyStateSrc;
    }

    // Update footer based on platform
    const copyKey = document.getElementById('copyKey');
    if (copyKey) {
      const platform = window.electronAPI.getPlatform();
      copyKey.textContent = platform === 'darwin' ? 'Cmd' : 'Ctrl';
    }
  } catch (error) {
    console.error('Failed to set icon paths:', error);
  }
}

// Listen for history updates from main process
window.electronAPI.onHistoryUpdated((newHistory) => {
  history = newHistory;
  applyFilters();
  renderHistory();
});

// Listen for settings changes (including theme changes)
window.electronAPI.onSettingsChanged((newSettings) => {
  applyTheme(newSettings);
});

// Load initial history
async function loadHistory() {
  const rawHistory = await window.electronAPI.getHistory();
  
  // Client-side deduplication as extra safety
  const seen = new Set();
  history = rawHistory.filter(item => {
    if (!item || !item.content) return false;
    const key = `${item.type}:${item.content}`;
    if (seen.has(key)) {
      console.warn('Duplicate detected in display, filtering out');
      return false;
    }
    seen.add(key);
    return true;
  });
  
  applyFilters();
  renderHistory();
}

// Setup event listeners
function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    applyFilters();
    renderHistory();
    selectedIndex = -1;
  });

  // Filter tabs
  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active state
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Apply filter
      currentFilter = tab.dataset.filter;
      applyFilters();
      renderHistory();
      selectedIndex = -1;
      focusSearch();
    });
  });

  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => {
    window.electronAPI.showSettings();
  });

  // Drawer event listeners
  document.getElementById('drawerCloseBtn').addEventListener('click', closeTextDrawer);
  document.getElementById('copyDrawerBtn').addEventListener('click', copyDrawerContent);
  const drawerContent = document.querySelector('.drawer-content');
  if (drawerContent) {
    drawerContent.addEventListener('click', () => {
      copyDrawerContent();
      closeTextDrawer();
    });
  }
  
  // Close drawer on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('textDrawer').classList.contains('open')) {
      closeTextDrawer();
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', handleKeyPress);

  // Intercept native copy events so selections inside rendered HTML preview
  // don't copy the syntax-highlighted DOM (with inline spans/styles). If the
  // selection is inside a history item we set the clipboard using the stored
  // original content (both html and text) via the main process.
  document.addEventListener('copy', async (e) => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return; // nothing selected

      const anchorNode = sel.anchorNode;
      if (!anchorNode) return;

      const itemEl = anchorNode.nodeType === 1
        ? anchorNode.closest('.history-item')
        : anchorNode.parentElement && anchorNode.parentElement.closest
          ? anchorNode.parentElement.closest('.history-item')
          : null;

      if (!itemEl) return; // not inside a history item

      const index = parseInt(itemEl.dataset.index);
      if (Number.isNaN(index)) return;

      const item = filteredHistory[index];
      if (!item) return;

      // Only intercept for HTML items (others can use default copy)
      if (item.type === 'html') {
        e.preventDefault();
        const formatted = formatHtmlOrXml(item.content || '');
        await window.electronAPI.copyToClipboard({ html: item.content || '', text: formatted });
        showCopiedNotification();
      }
    } catch (err) {
      console.error('Error handling copy event:', err);
    }
  });
}

// Apply filters
function applyFilters() {
  filteredHistory = history.filter(item => {
    // Apply type filter
    if (currentFilter === 'pinned' && !item.pinned) return false;
    if (currentFilter !== 'all' && currentFilter !== 'pinned' && item.type !== currentFilter) return false;
    
    // Apply search filter
    if (searchQuery) {
      const searchableContent = (item.preview || item.content || '').toLowerCase();
      const itemTags = (item.tags || []).join(' ').toLowerCase();
      if (!searchableContent.includes(searchQuery) && !itemTags.includes(searchQuery)) return false;
    }
    
    return true;
  });

  // Sort: pinned items first, then by timestamp (newest first)
  filteredHistory.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });
}

// Render history
function renderHistory() {
  const historyList = document.getElementById('historyList');
  const emptyState = document.getElementById('emptyState');

  if (filteredHistory.length === 0) {
    historyList.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');
  historyList.innerHTML = filteredHistory.map((item, index) => 
    createHistoryItemHTML(item, index)
  ).join('');

  // Attach event listeners
  attachItemEventListeners();
}

// Create history item HTML
function createHistoryItemHTML(item, index) {
  const isSelected = index === selectedIndex;
  const typeIcon = getTypeIcon(item.type);
  const formattedTime = formatTimestamp(item.timestamp);
  const tagsHTML = item.tags && item.tags.length > 0 
    ? `<div class="item-tags">${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>`
    : '';
  
  // Check if content is lengthy. Images should not be marked "lengthy" (no "View Full").
  const lengthy = item.type !== 'image' && isLengthyContent(item.content);
  const contentClass = lengthy ? 'lengthy' : '';
  
  return `
    <div class="history-item ${isSelected ? 'selected' : ''} ${item.pinned ? 'pinned' : ''}" data-index="${index}" data-id="${item.id}">
      <div class="item-header">
        <div class="item-type">
          ${typeIcon}
          <span>${item.type}</span>
        </div>
        <div class="item-actions">
          <button class="action-btn pin-btn ${item.pinned ? 'pinned' : ''}" data-action="pin" title="${item.pinned ? 'Unpin' : 'Pin'}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29.5 0 11.4 148.2c36.7 19.9 65.7 53.2 79.5 94.7l1 3c3.3 9.8 1.6 20.5-4.4 28.8s-15.7 13.3-26 13.3L32 352c-10.3 0-19.9-4.9-26-13.3s-7.7-19.1-4.4-28.8l1-3c13.8-41.5 42.8-74.8 79.5-94.7L93.5 64 64 64C46.3 64 32 49.7 32 32zM160 384l64 0 0 96c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-96z"/></svg>
          </button>
          ${item.pinned ? `<button class="action-btn tag-btn" data-action="tag" title="Manage Tags">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M345 39.1L472.8 168.4c52.4 53 52.4 138.2 0 191.2L360.8 472.9c-9.3 9.4-24.5 9.5-33.9 .2s-9.5-24.5-.2-33.9L438.6 325.9c33.9-34.3 33.9-89.4 0-123.7L310.9 72.9c-9.3-9.4-9.2-24.6 .2-33.9s24.6-9.2 33.9 .2zM0 229.5L0 80C0 53.5 21.5 32 48 32l149.5 0c17 0 33.3 6.7 45.3 18.7l168 168c25 25 25 65.5 0 90.5L277.3 442.7c-25 25-65.5 25-90.5 0l-168-168C6.7 262.7 0 246.5 0 229.5zM144 144a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/></svg>
          </button>` : ''}
          <button class="action-btn delete-btn" data-action="delete" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M135.2 17.7L128 32 32 32C14.3 32 0 46.3 0 64S14.3 96 32 96l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0-7.2-14.3C307.4 6.8 296.3 0 284.2 0L163.8 0c-12.1 0-23.2 6.8-28.6 17.7zM416 128L32 128 53.2 467c1.6 25.3 22.6 45 47.9 45l245.8 0c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>
          </button>
        </div>
      </div>
      <div class="item-content ${item.type} ${contentClass}">
        ${getContentHTML(item)}
      </div>
      <div class="item-footer">
        ${tagsHTML}
        <span class="item-timestamp">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          ${formattedTime}
        </span>
      </div>
    </div>
  `;
}

// Get type icon
function getTypeIcon(type) {
  const icons = {
    text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7V4H20V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 20H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 18L22 12L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 6L2 12L8 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15L16 10L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  return icons[type] || icons.text;
}

// Get content HTML
function getContentHTML(item) {
  if (item.type === 'image') {
    return `<img src="${item.content}" alt="Clipboard image">`;
  }
  if (item.type === 'html') {
    // Render the HTML content safely by sanitizing it and returning the HTML
    const safe = sanitizeHtml(item.content || '');
    return `<div class="html-content">${safe}</div>`;
  }
  return escapeHtml(item.preview || item.content || '');
}

// Format timestamp
function formatTimestamp(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

// Attach item event listeners
function attachItemEventListeners() {
  const items = document.querySelectorAll('.history-item');
  
  items.forEach(item => {
    // Click on item to copy 
    item.addEventListener('click', (e) => {
      if (e.target.closest('.action-btn')) return;
      // Check if clicking on lengthy indicator
      if (e.target.closest('.item-content.lengthy')) {
        const index = parseInt(item.dataset.index);
        openTextDrawer(index);
        return;
      }
      const index = parseInt(item.dataset.index);
      copyItem(index);
    });

    // Action buttons
    const pinBtn = item.querySelector('.pin-btn');
    const tagBtn = item.querySelector('.tag-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
    pinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      togglePin(id);
    });
    
    tagBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      showTagDialog(id);
    });
    
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      deleteItem(id);
    });
  });
}

// Handle keyboard events
function handleKeyPress(e) {
  const searchInput = document.getElementById('searchInput');
  
  // Close window on Escape
  if (e.key === 'Escape') {
    window.electronAPI.hideWindow();
    return;
  }
  
  // Arrow navigation
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < filteredHistory.length - 1) {
      selectedIndex++;
      updateSelection();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex > 0) {
      selectedIndex--;
      updateSelection();
    } else if (selectedIndex === 0) {
      selectedIndex = -1;
      updateSelection();
      focusSearch();
    }
  }
  
  // Copy selected item on Enter or Cmd/Ctrl+C (if no text selected)
  if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault();
    copyItem(selectedIndex);
    return;
  }
  
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
    const selection = window.getSelection().toString();
    if (selection) {
      // Allow default copy of selected text
      return;
    }
    if (selectedIndex >= 0) {
      e.preventDefault();
      copyItem(selectedIndex);
      return;
    }
  }
  
  // Focus search on any character key (if not already focused and no dialog is open)
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && document.activeElement !== searchInput && !document.getElementById('tagDialog')) {
    focusSearch();
  }
}

// Update selection
function updateSelection() {
  const items = document.querySelectorAll('.history-item');
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('selected');
    }
  });
}

// Copy item to clipboard
async function copyItem(index) {
  const item = filteredHistory[index];
  if (!item) return;
  
  let payload;
  if (item.type === 'html') {
    // Preserve both HTML and plain text flavors when copying so pasted
    // content retains formatting when the destination supports it.
    // Format HTML/XML source for nicer output, then send both html and text
    const formatted = formatHtmlOrXml(item.content || '');
    payload = { html: item.content || '', text: formatted };
  } else {
    payload = { text: item.content };
  }

  await window.electronAPI.copyToClipboard(payload);
  showCopiedNotification();
  window.electronAPI.hideWindow();
}

// Toggle pin
async function togglePin(id) {
  history = await window.electronAPI.pinItem(id);
  applyFilters();
  renderHistory();
}

// Delete item
async function deleteItem(id) {
  const item = history.find(h => h.id === id);
  
  // Check if item is pinned
  if (item && item.pinned) {
    // Show visual feedback that pinned items cannot be deleted
    const itemElement = document.querySelector(`[data-id="${id}"]`);
    if (itemElement) {
      itemElement.style.animation = 'shake 0.3s';
      setTimeout(() => {
        itemElement.style.animation = '';
      }, 300);
    }
    return;
  }
  
  history = await window.electronAPI.deleteItem(id);
  applyFilters();
  renderHistory();
  
  // Adjust selected index if needed
  if (selectedIndex >= filteredHistory.length) {
    selectedIndex = filteredHistory.length - 1;
  }
}

// Focus search input
function focusSearch() {
  const searchInput = document.getElementById('searchInput');
  searchInput.focus();
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Basic HTML sanitizer: remove script/style tags and dangerous attributes
function sanitizeHtml(html) {
  if (!html) return '';
  // Remove script and style blocks
  let cleaned = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');

  // Remove on* attributes and javascript: URIs
  cleaned = cleaned.replace(/ on[\w-]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  cleaned = cleaned.replace(/href=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');

  // Remove iframe/object/embed
  cleaned = cleaned.replace(/<(iframe|object|embed)[\s\S]*?>[\s\S]*?<\/(iframe|object|embed)>/gi, '');

  return cleaned;
}

// Strip tags, used for copying visible text
function stripTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ');
}

// Decode HTML entities to plain text
function decodeHtmlEntities(text) {
  const txt = document.createElement('textarea');
  txt.innerHTML = text;
  return txt.value;
}

// Show tag management dialog
async function showTagDialog(itemId) {
  const item = history.find(i => i.id === itemId);
  if (!item) return;

  const response = await window.electronAPI.getAllTags();
  const allTags = response.tags || [];
  const currentTags = item.tags || [];

  // Create dialog HTML
  const dialogHTML = `
    <div id="tagDialog" class="tag-dialog-overlay">
      <div class="tag-dialog">
        <div class="tag-dialog-header">
          <h3>Manage Tags</h3>
          <button class="tag-dialog-close">&times;</button>
        </div>
        <div class="tag-dialog-body">
          <div class="tag-input-container">
            <input type="text" id="tagInput" placeholder="Add a tag..." autocomplete="off">
            <button id="addTagBtn">Add</button>
          </div>
          <div class="current-tags">
            <h4>Current Tags:</h4>
            <div class="tag-list" id="currentTagList">
              ${currentTags.map(tag => `
                <span class="tag-item">
                  ${tag}
                  <button class="remove-tag" data-tag="${tag}">&times;</button>
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', dialogHTML);

  const dialog = document.getElementById('tagDialog');
  const tagInput = document.getElementById('tagInput');
  const addTagBtn = document.getElementById('addTagBtn');
  const currentTagList = document.getElementById('currentTagList');

  // Setup autocomplete
  setupTagAutocomplete(tagInput, allTags);

  // Focus the input
  setTimeout(() => tagInput.focus(), 100);

  // Add tag event
  const addTag = async () => {
    const tag = tagInput.value.trim();
    if (tag && !currentTags.includes(tag)) {
      try {
        const result = await window.electronAPI.addTagToItem(itemId, tag);
        if (result.success) {
          currentTags.push(tag);
          updateTagList();
          tagInput.value = '';
          // Update local history
          const item = history.find(i => i.id === itemId);
          if (item) {
            item.tags = currentTags;
            applyFilters();
            renderHistory();
          }
        }
      } catch (error) {
        console.error('Failed to add tag:', error);
      }
    }
  };

  addTagBtn.addEventListener('click', addTag);
  tagInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTag();
  });

  // Remove tag event
  currentTagList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('remove-tag')) {
      const tag = e.target.dataset.tag;
      try {
        const result = await window.electronAPI.removeTagFromItem(itemId, tag);
        if (result.success) {
          const index = currentTags.indexOf(tag);
          if (index > -1) currentTags.splice(index, 1);
          updateTagList();
          // Update local history
          const item = history.find(i => i.id === itemId);
          if (item) {
            item.tags = currentTags;
            applyFilters();
            renderHistory();
          }
        }
      } catch (error) {
        console.error('Failed to remove tag:', error);
      }
    }
  });

  // Close dialog
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.classList.contains('tag-dialog-close')) {
      dialog.remove();
    }
  });

  function updateTagList() {
    currentTagList.innerHTML = currentTags.map(tag => `
      <span class="tag-item">
        ${tag}
        <button class="remove-tag" data-tag="${tag}">&times;</button>
      </span>
    `).join('');
  }
}

// Setup tag autocomplete
function setupTagAutocomplete(input, allTags) {
  let suggestions = [];
  let selectedIndex = -1;

  const suggestionContainer = document.createElement('div');
  suggestionContainer.className = 'tag-suggestions';
  input.parentNode.appendChild(suggestionContainer);

  input.addEventListener('focus', () => {
    const value = input.value.trim().toLowerCase();
    if (value.length === 0) {
      suggestions = allTags.slice(0, 5);
    } else {
      suggestions = allTags.filter(tag => 
        tag.toLowerCase().startsWith(value)
      ).slice(0, 5);
    }
    selectedIndex = -1;
    renderSuggestions();
  });

  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    if (value.length === 0) {
      suggestions = allTags.slice(0, 5);
      selectedIndex = -1;
    } else {
      // Show existing tags that start with the input value
      suggestions = allTags.filter(tag => 
        tag.toLowerCase().startsWith(value)
      ).slice(0, 5);
      selectedIndex = -1;
    }
    renderSuggestions();
  });

  input.addEventListener('blur', () => {
    // Delay hiding to allow click on suggestions
    setTimeout(() => {
      suggestions = [];
      renderSuggestions();
    }, 150);
  });

  function renderSuggestions() {
    if (suggestions.length === 0) {
      suggestionContainer.innerHTML = '';
      suggestionContainer.style.display = 'none';
      return;
    }

    suggestionContainer.style.display = 'block';
    suggestionContainer.innerHTML = suggestions.map((tag, index) => 
      `<div class="tag-suggestion ${index === selectedIndex ? 'selected' : ''}" data-tag="${tag}">${tag}</div>`
    ).join('');

    // Add click handlers
    suggestionContainer.querySelectorAll('.tag-suggestion').forEach((el, index) => {
      el.addEventListener('click', () => {
        input.value = suggestions[index];
        suggestions = [];
        renderSuggestions();
        input.focus();
      });
    });
  }
}

// Apply theme (optionally accepts pre-fetched settings to avoid extra IPC)
async function applyTheme(prefetchedSettings) {
  const settings = prefetchedSettings || await window.electronAPI.getSettings();
  const theme = settings.theme || 'system';
  let effectiveTheme = theme;

  if (theme === 'system') {
    // Detect system theme
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Apply Spring Glass transparency if relevant
  if (effectiveTheme === 'spring-glass') {
    const transparency = typeof settings.springGlassTransparency === 'number' ? settings.springGlassTransparency : 65;
    const opacity = Math.min(Math.max(transparency, 0), 100) / 100;
    const bg = `rgba(248, 255, 252, ${opacity})`;
    document.documentElement.style.setProperty('--spring-glass-bg', bg);
  } else {
    // Reset to default when not in spring-glass
    document.documentElement.style.removeProperty('--spring-glass-bg');
  }

  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

// Show "Copied" notification
function showCopiedNotification() {
  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = 'Copied';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    background: rgba(76, 175, 80, 0.95);
    color: white;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideInRight 0.3s ease-out, fadeOut 0.3s ease-in 1.7s;
    pointer-events: none;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 2000);
}

// Text Drawer Functions
function openTextDrawer(index) {
  const item = filteredHistory[index];
  if (!item) return;

  const drawer = document.getElementById('textDrawer');
  const drawerText = document.getElementById('drawerText');
  const overlay = document.querySelector('.drawer-overlay') || createOverlay();
  const itemEl = document.querySelector(`.history-item[data-index="${index}"]`);
  
  // Get the content to display
  let content = '';
  if (item.type === 'text') {
    content = item.content || '';
  } else if (item.type === 'html') {
    content = formatHtmlOrXml(item.content || '');
  } else {
    content = item.content || '';
  }
  
  // Store current content for copy
  drawerText.textContent = content;
  drawer.classList.add('open');
  overlay.classList.add('active');

  // Position drawer and arrow relative to the clicked item
  requestAnimationFrame(() => {
    positionDrawer(itemEl);
  });
  
  // Close on overlay click
  overlay.onclick = closeTextDrawer;
}

function closeTextDrawer() {
  const drawer = document.getElementById('textDrawer');
  const overlay = document.querySelector('.drawer-overlay');
  
  drawer.classList.remove('open');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

function copyDrawerContent() {
  const drawerText = document.getElementById('drawerText');
  const content = drawerText.textContent;
  
  if (!content) return;
  
  window.electronAPI.copyToClipboard(content).then(() => {
    showCopiedNotification();
    closeTextDrawer();
  });
}

function positionDrawer(anchorEl) {
  const drawer = document.getElementById('textDrawer');
  if (!drawer || !anchorEl) return;

  // Prepare for measurement
  drawer.style.visibility = 'hidden';
  drawer.classList.add('open');

  const margin = 0;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const anchorRect = anchorEl.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();

  const left = margin;
  const arrowSide = 'right';

  let top = anchorRect.top + anchorRect.height / 2 - drawerRect.height / 2;
  top = Math.max(margin, Math.min(top, viewportHeight - drawerRect.height - margin));

  // Arrow position relative to drawer
  const anchorMid = anchorRect.top + anchorRect.height / 2;
  let arrowTop = anchorMid - top;
  const minTop = 14;
  const maxTop = drawerRect.height - 14;
  arrowTop = Math.max(minTop, Math.min(arrowTop, maxTop));

  drawer.style.setProperty('--drawer-top', `${Math.round(top)}px`);
  drawer.style.setProperty('--drawer-left', `${Math.round(left)}px`);
  drawer.style.setProperty('--drawer-arrow-top', `${Math.round(arrowTop)}px`);
  drawer.style.setProperty('--drawer-shift', arrowSide === 'right' ? '8px' : '-8px');

  drawer.classList.toggle('arrow-right', arrowSide === 'right');

  // Reveal after positioning
  drawer.style.visibility = '';
}

function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

// Determine if content is lengthy (more than 300 characters or 5 lines)
function isLengthyContent(content) {
  if (!content) return false;
  const lineCount = (content.match(/\n/g) || []).length + 1;
  return content.length > 300 || lineCount > 5;
}
