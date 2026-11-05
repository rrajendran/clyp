# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Clyp is a cross-platform clipboard manager built with **Tauri 2**: a Rust backend (`src-tauri/`) and a plain HTML/CSS/JS frontend (`src/`, no bundler, no TypeScript). It was migrated from Electron; the legacy Electron data file is imported on first launch.

## Commands

```bash
npm install
npm run dev                # tauri dev (debug build, runs the app)
npm run build              # tauri build (installers for the host OS)
npm test                   # UI tests (jsdom, test/ui) + Rust unit tests
npm run test:ui            # UI tests only
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_github --nocapture   # opt-in: real GitHub update check
cargo test --manifest-path src-tauri/Cargo.toml storage   # filter by name
npm run generate-icons     # regenerate all icons (app icon from assets/clyp-icon.png, tray glyph from src-tauri/icons/tray.svg)
./release.sh <version|patch|minor|major>   # bumps package.json, commits, tags vX.Y.Z, pushes main + tag
```

Requires Node, Rust (stable) and the Tauri platform prerequisites (Linux: webkit2gtk-4.1, libayatana-appindicator3). Releases are built by `.github/workflows/release.yml` (tauri-action) on a `v*` tag. The app version comes from `package.json` (`tauri.conf.json` points at it). Updates are a GitHub-releases check that opens the installer download (`updater.rs`); there is no in-place self-update.

## Architecture

- **`src-tauri/src/`** – Rust backend.
  - `lib.rs` – app setup, plugins (single-instance, global-shortcut, autostart, opener, dialog), shared `AppState`, run-loop (app stays alive with no windows).
  - `commands.rs` – every `#[tauri::command]` the UI can call, plus `apply_settings_patch` (the side effects of a settings change: shortcut, monitor on/off, autostart, theme, dock, tray menu).
  - `storage.rs` – `Store`: history + settings in `clyp-data.json` (app data dir), dedup by sha256, pinning, tags, auto-delete, legacy Electron import. Pure logic, unit-tested.
  - `clipboard.rs` – `Monitor` polls the clipboard (500ms, `arboard`) on a thread, plus clipboard writing helpers.
  - `windows.rs` – popup (`main`) and `settings` windows, tray/cursor anchored placement, native vibrancy on macOS, theme sync.
  - `tray.rs` – tray icon/menu and the macOS app menu. `updater.rs` – GitHub release check.
- **`src/`** – UI. `index.html` is the compact popup (header: maximise ▸ settings). `settings.html` is the big window (label `settings`, opened by the maximise button, tray, or ⌘,): a collapsible sidebar with a **Clipboard** group (All/Text/Images/Pinned) and a **Settings** group, plus a centred canvas whose width follows the view. It loads `js/renderer.js` (the shared history list; `body[data-mode]` = `popup`|`workspace`) and `js/settings.js` (navigation + settings). Landing page is chosen with `show_settings(section)` → `?go=clipboard/pinned` / `navigate` event. Scripts share one global scope, so keep function names unique across `renderer.js` and `settings.js`. `js/bridge.js` defines `window.clyp` (wraps `invoke`/events) and sets `data-platform` / `data-theme` on `<html>` before paint. **Adding a feature across the boundary needs three edits: a `#[tauri::command]` (registered in `lib.rs`), a wrapper in `bridge.js`, and the UI call.** Backend→UI pushes use the `history-updated` and `settings-changed` events.
- **Styling** – `css/theme.css` holds design tokens: light/dark palettes plus per-platform overrides (macOS HIG, Windows Fluent, Linux Adwaita) keyed on `[data-platform]`. Appearance setting is `system | light | dark`. A strict CSP is set in `tauri.conf.json`: no inline scripts; clipboard HTML is sanitised before rendering.

## Notes

- `.github/` contains generic Copilot instruction/prompt files (Java, SQL, etc.) that are mostly unrelated to this project.
- `CONTRIBUTING.md` still has placeholder `yourusername` URLs.
