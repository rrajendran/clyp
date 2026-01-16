#!/usr/bin/env node

/**
 * Generate tray icons from the main clyp-icon.png
 * This script uses Electron's nativeImage to resize the icon
 */

const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const sourceIcon = path.join(__dirname, 'clyp-icon.png');
const outputDir = __dirname;

console.log('🎨 Generating tray icons from clyp-icon.png...\n');

if (!fs.existsSync(sourceIcon)) {
  console.error('❌ Error: clyp-icon.png not found in assets/icons/');
  console.error('Please add the icon file first.');
  process.exit(1);
}

try {
  // Load the source image
  const image = nativeImage.createFromPath(sourceIcon);
  
  if (image.isEmpty()) {
    throw new Error('Failed to load source image');
  }
  
  console.log('✓ Source icon loaded');
  console.log(`  Original size: ${image.getSize().width}x${image.getSize().height}`);
  
  // Generate tray icons for different platforms
  
  // macOS Template icon (black/white, system will colorize)
  // Template icons should be monochrome with transparency
  const macTemplate16 = image.resize({ width: 16, height: 16 });
  const macTemplate32 = image.resize({ width: 32, height: 32 });
  
  fs.writeFileSync(
    path.join(outputDir, 'trayTemplate.png'),
    macTemplate16.toPNG()
  );
  fs.writeFileSync(
    path.join(outputDir, 'trayTemplate@2x.png'),
    macTemplate32.toPNG()
  );
  console.log('✓ macOS tray icons created (trayTemplate.png, trayTemplate@2x.png)');
  
  // Windows tray icon
  const windows16 = image.resize({ width: 16, height: 16 });
  const windows32 = image.resize({ width: 32, height: 32 });
  
  fs.writeFileSync(
    path.join(outputDir, 'tray-windows.png'),
    windows16.toPNG()
  );
  fs.writeFileSync(
    path.join(outputDir, 'tray-windows@2x.png'),
    windows32.toPNG()
  );
  console.log('✓ Windows tray icons created (tray-windows.png, tray-windows@2x.png)');
  
  // Linux tray icon
  const linux16 = image.resize({ width: 16, height: 16 });
  const linux32 = image.resize({ width: 32, height: 32 });
  
  fs.writeFileSync(
    path.join(outputDir, 'tray-linux.png'),
    linux16.toPNG()
  );
  fs.writeFileSync(
    path.join(outputDir, 'tray-linux@2x.png'),
    linux32.toPNG()
  );
  console.log('✓ Linux tray icons created (tray-linux.png, tray-linux@2x.png)');
  
  // Generate app icons for electron-builder
  console.log('\n📦 Generating app icons for builds...');
  
  // macOS needs icns (use electron-builder or manual conversion)
  // Windows needs ico (use electron-builder or manual conversion)
  // Linux needs various PNG sizes
  
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  
  sizes.forEach(size => {
    const resized = image.resize({ width: size, height: size });
    fs.writeFileSync(
      path.join(outputDir, `icon-${size}x${size}.png`),
      resized.toPNG()
    );
  });
  
  console.log('✓ App icons created (16x16 through 1024x1024)');
  
  // Copy the largest as icon.png for electron-builder
  const icon1024 = image.resize({ width: 1024, height: 1024 });
  fs.writeFileSync(
    path.join(outputDir, 'icon.png'),
    icon1024.toPNG()
  );
  console.log('✓ Main icon.png created (1024x1024)');
  
  console.log('\n✅ All icons generated successfully!');
  console.log('\nNote: For production builds, you should convert:');
  console.log('  - icon.png → icon.icns (macOS) using iconutil or electron-builder');
  console.log('  - icon.png → icon.ico (Windows) using convert or electron-builder');
  console.log('\nelectron-builder will handle these conversions automatically during build.');
  
} catch (error) {
  console.error('❌ Error generating icons:', error.message);
  process.exit(1);
}
