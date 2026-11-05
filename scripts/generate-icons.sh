#!/bin/bash
# Regenerates every icon from two sources:
#   assets/clyp-icon.png          -> app icon (macOS .icns, Windows .ico, Linux PNGs) + UI logos
#   src-tauri/icons/tray.svg      -> macOS menu-bar template glyph (tray.png)
# Needs: npx (tauri CLI), sips + iconutil (macOS), rsvg-convert.
set -euo pipefail
cd "$(dirname "$0")/.."
ICONS=src-tauri/icons
WORK=$(mktemp -d)

# 1. Tauri's platform icon set
npx tauri icon assets/clyp-icon.png >/dev/null

# 2. macOS .icns on Apple's icon grid (artwork 824px inside a 1024 canvas)
magick assets/clyp-icon.png -resize 824x824 -background none -gravity center -extent 1024x1024 "$WORK/mac.png"
mkdir "$WORK/mac.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/mac.png" --out "$WORK/mac.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$WORK/mac.png" --out "$WORK/mac.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/mac.iconset" -o "$ICONS/icon.icns"

# 3. Logos shown inside the UI
for s in 32 128; do sips -z $s $s assets/clyp-icon.png --out "src/assets/icon-$s.png" >/dev/null; done

# 4. Tray glyph (black on transparent; macOS tints it as a template image)
rsvg-convert -w 44 -h 44 "$ICONS/tray.svg" -o "$ICONS/tray.png"

# 5. Drop outputs Clyp does not use (mobile, Windows Store tiles, spare sizes)
rm -rf "$ICONS/android" "$ICONS/ios" "$ICONS"/Square*.png "$ICONS/StoreLogo.png" "$ICONS/64x64.png"
rm -rf "$WORK"
echo "Icons regenerated."
