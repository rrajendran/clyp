**ClipboardMonitor**

Overview
- **Purpose:** Watches the system clipboard (Electron main process) and emits events when new, non-duplicate clipboard content is detected and accepted by the storage manager.
- **Supported types:** text, html (rich text), image (data URL). Files are recognized as a placeholder and currently treated as `file` with mime `application/octet-stream`.
- **Polling:** By default polls every 500ms (configurable by modifying `pollInterval` in the source).

Key behaviors
- **Deduplication:** Uses a content hash (MD5) to deduplicate clipboard entries. For HTML and plain text, the monitor canonicalizes by visible text so "Settings" and the same text wrapped in HTML dedupe.
- **Normalization:** Visible text is normalized (trim + collapse whitespace) before hashing so small differences in spacing or HTML wrappers don't create duplicates.
- **Preferred flavor:** If both `text/plain` and `text/html` formats are present and the visible HTML text equals the plain text, the monitor treats the clip as plain `text` to avoid adding two separate items.
- **Image handling:** Detects image formats from clipboard available formats and stores image content as a data URL with a preview showing size.

Public API
- Constructor: `new ClipboardMonitor(storageManager)`
  - `storageManager` must implement:
    - `getSettings()` — returns settings object (e.g., { captureImages, captureRichText, captureText }).
    - `addItem(item)` — persist an item; should return `true` when added or `false` when rejected (duplicate or filtered).
- Methods:
  - `start()` — begin monitoring the clipboard.
  - `stop()` — stop monitoring.
  - `pause()` — temporarily pause monitoring (useful when the app writes to clipboard).
  - `resume()` — resume monitoring.
- Events (inherits from EventEmitter):
  - `clipboard-change` — emitted when a new item is successfully added; listener receives the stored item object.

Item shape (fields the monitor produces)
- `id` — string (timestamp-based by default)
- `timestamp` — number (ms since epoch)
- `type` — 'text' | 'html' | 'image' | 'file' | 'unknown'
- `content` — raw content (plain text, HTML string, or image data URL)
- `preview` — short human-readable preview used for UI
- `pinned` — boolean (default false)
- `tags` — array (default [])

Usage example
```
const ClipboardMonitor = require('./clipboardMonitor');

const storageManager = {
  getSettings: () => ({ captureImages: true, captureRichText: true, captureText: true }),
  addItem: item => { console.log('storing', item.preview); return true; }
};

const monitor = new ClipboardMonitor(storageManager);
monitor.on('clipboard-change', item => console.log('New item:', item));
monitor.start();
```

Implementation notes & suggestions
- File lives in the Electron main process and uses `clipboard` and `nativeImage` from Electron — it cannot run in the renderer without enabling Node integration.
- The default `pollInterval` of 500ms is a tradeoff between responsiveness and power usage. Consider making it configurable (via settings) and increasing to 1000–2000ms for battery-sensitive devices.
- Deduplication uses MD5 for speed. If collision resistance is a concern, switch to SHA-256.
- `application/octet-stream` for files is currently a placeholder. To support file lists, detect platform-specific clipboard formats and read buffers appropriately.
- Avoid expensive sync work in the interval handler; heavy tasks (image processing, disk I/O) should be offloaded to async workers.

Testing ideas
- Unit test `normalizeText`, `stripHtml`, and `hashContent` edge cases.
- Integration test: mock Electron's `clipboard` and provide a fake `storageManager` to assert `clipboard-change` emissions.

Security
- When handling `text/html`, the monitor strips tags for normalization and preview generation, but the raw HTML is stored in the `content` field for `html` items. Be careful if you later render raw HTML in the renderer — sanitize before injecting into the DOM.

Change log
- v1.0 — Initial in-repo README describing behavior, API, and suggestions.
