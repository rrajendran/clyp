# Clyp v1.0.3 Release Notes

**Release Date:** January 25, 2026

## 🐛 Bug Fixes

### Copy Functionality Fix
- **Fixed clipboard copy issues** caused by z-index preventing proper interaction with copy buttons
  - Resolved issue where pinned/unpinned items couldn't be copied
  - Fixed "View Full" drawer copy button not working
  - Fixed clicking on drawer content to copy not functioning
  - All three copy methods (item click, drawer button, drawer content click) now work correctly

## ✨ Enhancements

### Publishing & Distribution
- **Added GitHub publish scripts** for automated releases
  - `npm run publish` - Publish all platforms (macOS, Windows, Linux)
  - `npm run publish:mac` - Publish macOS builds only
  - `npm run publish:win` - Publish Windows builds only
  - `npm run publish:linux` - Publish Linux builds only
  - Auto-update enabled for all published releases

### Multi-Architecture Support
- **macOS**: Now builds for both Intel (x64) and Apple Silicon (arm64)
  - DMG installers for both architectures
  - ZIP packages for both architectures
- **Linux**: Now builds for both x64 and arm64
  - AppImage for x64 and arm64
  - DEB packages for x64 and arm64

### Build Optimizations
- **Improved artifact naming** with consistent pattern: `${productName}-${version}-${os}-${arch}.${ext}`
- **Maximum compression** enabled for smaller package sizes
- **ASAR packaging** enabled for faster app loading

## 🧪 Testing

### New Test Suite
- **Added comprehensive copy functionality tests** (20+ test cases)
  - Tests for item click copy (text, HTML, styled HTML)
  - Tests for drawer copy button (text, multiline, formatted HTML)
  - Tests for drawer content click (unicode support)
  - Edge case handling (null, undefined, long text, malformed HTML)
  - Content type verification (text/HTML detection, beautification)

## 📦 Distribution

### Available Builds

**macOS (Intel & Apple Silicon)**
- `Clyp-1.0.3-mac-x64.dmg` - Intel installer
- `Clyp-1.0.3-mac-arm64.dmg` - Apple Silicon installer
- `Clyp-1.0.3-mac-x64.zip` - Intel portable
- `Clyp-1.0.3-mac-arm64.zip` - Apple Silicon portable

**Linux (x64 & arm64)**
- `Clyp-1.0.3-linux-x86_64.AppImage` - x64 portable
- `Clyp-1.0.3-linux-arm64.AppImage` - arm64 portable
- `Clyp-1.0.3-linux-amd64.deb` - x64 Debian package
- `Clyp-1.0.3-linux-arm64.deb` - arm64 Debian package

**Windows (x64)**
- `Clyp-1.0.3-win-x64.exe` - Windows installer

## 🔧 Technical Details

### Package Changes
- Added publish scripts to `package.json`
- Configured GitHub releases with auto-update support
- Enhanced build configuration for multi-arch support

### Test Coverage
- 4 test suites
- 95 tests passing
- Copy functionality fully tested

## 📝 Migration Notes

No breaking changes in this release. Users can upgrade seamlessly from v1.0.2.

## 🙏 Acknowledgments

Thanks to all users who reported the copy functionality issues!

---

**Full Changelog**: https://github.com/rameshchinnu61/clyp/compare/v1.0.2...v1.0.3
