#!/bin/bash
# Create simple 16x16 PNG icons using ImageMagick or similar
# For now, create placeholder files
echo "Creating placeholder PNG icons..."

# Create a simple 16x16 black square for macOS template
convert -size 16x16 xc:black trayTemplate.png
convert -size 32x32 xc:black trayTemplate@2x.png

# Create a simple 16x16 blue square for Windows/Linux
convert -size 16x16 xc:#4A90E2 tray-windows.png
convert -size 32x32 xc:#4A90E2 tray-windows@2x.png
convert -size 16x16 xc:#4A90E2 tray-linux.png
convert -size 32x32 xc:#4A90E2 tray-linux@2x.png

echo "Icons created!"
