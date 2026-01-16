# Clyp

**Fast, Private, Cross-Platform Clipboard Manager**

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Overview

Clyp is a lightweight, privacy-focused clipboard manager that runs silently in the background and provides instant access to your clipboard history via a global keyboard shortcut. Built with Electron, it offers a seamless cross-platform experience while keeping all your data stored locally.

## Features

✨ **Fast & Lightweight**
- Starts in under 500ms
- Uses less than 150MB of memory
- Instant response to keyboard shortcuts

🔒 **Privacy-First**
- 100% local storage
- No cloud sync or telemetry
- Optional data encryption

📋 **Smart Clipboard Management**
- Capture text, rich text, images, and files
- Search through history instantly
- Pin important items
- Automatic deduplication

⌨️ **Keyboard-Driven**
- Global shortcut access (⌘⇧V / Ctrl⇧V)
- Full keyboard navigation
- Configurable shortcuts

🎨 **Beautiful UI**
- Modern, clean interface
- Light and dark mode support
- High-DPI friendly

🖥️ **Cross-Platform**
- macOS (Intel & Apple Silicon)
- Windows (x64)
- Linux (AppImage, deb, rpm)

## Installation

### macOS

```bash
# Download the latest DMG from releases
# Or install via Homebrew (coming soon)
brew install --cask clyp
```

### Windows

```bash
# Download the latest installer from releases
# Or install via Chocolatey (coming soon)
choco install clyp
```

### Linux

```bash
# AppImage
chmod +x Clyp-1.0.0.AppImage
./Clyp-1.0.0.AppImage

# Debian/Ubuntu
sudo dpkg -i clyp_1.0.0_amd64.deb

# Fedora/RHEL
sudo rpm -i clyp-1.0.0.x86_64.rpm
```

## Quick Start

1. **Launch Clyp** - It will start in the background with a tray/menu bar icon
2. **Copy something** - Any text, image, or file path
3. **Open history** - Press `⌘⇧V` (Mac) or `Ctrl⇧V` (Windows/Linux)
4. **Select & paste** - Navigate with arrow keys, press Enter to copy

## Usage

### Global Shortcuts

- **Open Clipboard History**: `⌘⇧V` (Mac) or `Ctrl⇧V` (Windows/Linux)
- **Navigate**: `↑` / `↓` arrow keys
- **Copy Selected**: `Enter`
- **Close**: `Esc`

### Tray Menu

Right-click the tray icon to access:
- Open Clipboard History
- Settings
- Pause/Resume Monitoring
- Clear History
- Quit

### Search & Filter

- Type in the search bar to filter history
- Use filter tabs to show specific types (Text, Images, Pinned)
- Real-time filtering as you type

### Pin Items

- Hover over any item and click the pin icon
- Pinned items stay at the top and are never auto-deleted
- Perfect for frequently used snippets

## Configuration

Access settings via the tray menu or settings button in the main window.

### General Settings

- **Start on Boot**: Launch automatically when you log in
- **Max History Size**: Number of items to keep (default: 100)
- **Monitoring**: Enable/disable clipboard monitoring

### Capture Settings

- **Text**: Plain text content
- **Rich Text**: HTML and formatted text
- **Images**: Screenshots and copied images
- **Files**: File path references

### Privacy Settings

- **Auto-Delete History**: Automatically remove old items
- **Auto-Delete Days**: How long to keep items (default: 30 days)
- **Clear All Data**: Remove all clipboard history and settings

### Shortcuts

Customize global keyboard shortcuts (requires restart)

## Development

### Prerequisites

- Node.js 18+ and npm
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/clyp.git
cd clyp

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for your platform
npm run build
```

### Project Structure

```
clyp/
├── app/
│   ├── main/              # Main process (Electron)
│   │   ├── main.js
│   │   ├── clipboardMonitor.js
│   │   └── tray.js
│   ├── renderer/          # Renderer process (UI)
│   │   ├── index.html
│   │   ├── renderer.js
│   │   ├── settings.html
│   │   └── settings.js
│   └── shared/            # Shared utilities
│       ├── storage.js
│       └── constants.js
├── assets/                # Icons and resources
├── config/                # Build configuration
└── package.json
```

### Build Commands

```bash
# Start development
npm run dev

# Build for all platforms
npm run build

# Build for specific platform
npm run build:mac
npm run build:win
npm run build:linux
```

## Technology Stack

- **Framework**: Electron 28+
- **Storage**: electron-store
- **Build**: electron-builder
- **UI**: Vanilla HTML/CSS/JavaScript

## Roadmap

- [ ] Cloud sync (optional, encrypted)
- [ ] Cross-device clipboard sharing
- [ ] AI-powered suggestions
- [ ] Snippet templates and variables
- [ ] Custom theme support
- [ ] Browser extensions
- [ ] Mobile companion apps

## Privacy & Security

Clyp is built with privacy as a core principle:

- ✅ All data stored locally on your device
- ✅ No analytics or telemetry
- ✅ No network requests (unless you enable sync)
- ✅ Optional encryption at rest
- ✅ Clear all data option
- ✅ Open source (audit the code yourself)

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- 📧 Email: support@clyp.app
- 🐛 Bug Reports: [GitHub Issues](https://github.com/yourusername/clyp/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/yourusername/clyp/discussions)
- 📖 Documentation: [docs.clyp.app](https://docs.clyp.app)

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

Created with ❤️ by the Clyp team

Special thanks to:
- The Electron community
- All our contributors
- You, for using Clyp!

---

**⭐ If you find Clyp useful, please consider starring the repository!**
