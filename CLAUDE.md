# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Clyp is an Electron (v28) cross-platform clipboard manager (plain JavaScript, CommonJS, no bundler/TypeScript). Entry point is `app/main/main.js`.

## Commands

```bash
npm install
npm start                 # run app
npm run dev               # run with --dev flag (dev tools / extra logging)
npm test                  # jest (all tests)
npx jest test/storage.test.js              # single test file
npx jest -t "name pattern"                 # single test by name
npm run test:coverage
npm run pack              # unpacked build into dist/
npm run build:mac|build:win|build:linux
npm run generate-icons    # regenerates icons via sharp
./release.sh <version|patch|minor|major>   # bumps package.json, commits, tags vX.Y.Z, pushes main + tag
```

There is no linter configured (CI's lint job is a no-op). Releases are built and published by GitHub Actions (`.github/workflows/release.yml`) when a `v*` tag is pushed; `electron-updater` consumes the GitHub releases for auto-update.

## Architecture

Standard Electron three-layer split under `app/`:

- **`app/main/`** – main process.
  - `main.js` (~1000 lines) owns app lifecycle, the main popup window and settings window, the global shortcut (registered/re-registered from the `shortcut` setting), auto-updater, and **all `ipcMain.handle` handlers** (history, settings, tags, copy, updates, start-on-boot, etc.).
  - `clipboardMonitor.js` – an `EventEmitter` that polls the system clipboard (500ms, slows to 1500ms on battery via `powerMonitor`), hashes content to detect changes, and emits new items. `main.js` wires it to `StorageManager` and pushes `history-updated` to renderers.
  - `tray.js` – `TrayManager` for the tray/menu-bar icon.
- **`app/renderer/`** – UI (`index.html`/`renderer.js` main popup; `settings.html`/`settings.js` settings window). Renderers have no Node access; they talk to main only through `window.electronAPI` defined in `preload.js` (contextBridge → `ipcRenderer.invoke`). **Adding a feature that crosses the boundary requires three edits: the `ipcMain.handle` in `main.js`, the wrapper in `preload.js`, and the renderer call.** Main→renderer pushes use the `history-updated` and `settings-changed` events.
- **`app/shared/`** – `storage.js` (`StorageManager`, wraps `electron-store` file `clyp-data`; holds `history` array and `settings` defaults, content-hash (sha256) dedup, tags, pinning, auto-delete) and `constants.js` (requires `electron`'s `app`, so it can't be loaded outside Electron/mocks; note its `APP_VERSION` is stale — real version comes from `package.json` via the `get-app-version` handler).

`copy-to-clipboard` in `main.js` uses `js-beautify` to format HTML content before writing it back to the clipboard.

## Tests

Jest (node environment) in `test/`, with `electron`, `electron-store`, and `crypto` mocked via `test/__mocks__/` (`moduleNameMapper` maps `electron` to the mock). Tests cover `clipboardMonitor`, `storage`, `tray`, and copy behavior. Coverage excludes `app/renderer/**`, `preload.js`, `main.js`, and `constants.js`, so logic that needs tests should live in the monitor/storage/tray modules rather than `main.js`.

## Notes

- `.github/` contains generic Copilot instruction/prompt files (Java, SQL, etc.) that are mostly unrelated to this project.
- `CONTRIBUTING.md` still has placeholder `yourusername` URLs.
