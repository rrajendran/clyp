#!/usr/bin/env node

/**
 * Generate tray icons using sharp (lightweight image processing)
 * Install: npm install --save-dev sharp
 */

const fs = require('fs');
const path = require('path');

const sourceIcon = path.join(__dirname, 'clyp-icon.png');
const outputDir = __dirname;

console.log('🎨 Generating tray icons from clyp-icon.png...\n');

if (!fs.existsSync(sourceIcon)) {
  console.error('❌ Error: clyp-icon.png not found in assets/icons/');
  console.error('Please add the icon file first.');
  process.exit(1);
}

// Check if sharp is installed
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('⚠️  sharp module not found. Installing...');
  const { execSync } = require('child_process');
  try {
    execSync('npm install --save-dev sharp', { stdio: 'inherit' });
    sharp = require('sharp');
    console.log('✓ sharp installed successfully\n');
  } catch (installError) {
    console.error('❌ Failed to install sharp. Please run: npm install --save-dev sharp');
    process.exit(1);
  }
}

async function generateIcons() {
  try {
    // Load the source image
    const image = sharp(sourceIcon);
    const metadata = await image.metadata();
    
    console.log('✓ Source icon loaded');
    console.log(`  Original size: ${metadata.width}x${metadata.height}\n`);
    
    // Generate tray icons for different platforms
    
    // macOS Template icons
    await sharp(sourceIcon)
      .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'trayTemplate.png'));
    
    await sharp(sourceIcon)
      .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'trayTemplate@2x.png'));
    
    console.log('✓ macOS tray icons created');
    
    // Windows tray icons
    await sharp(sourceIcon)
      .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'tray-windows.png'));
    
    await sharp(sourceIcon)
      .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'tray-windows@2x.png'));
    
    console.log('✓ Windows tray icons created');
    
    // Linux tray icons
    await sharp(sourceIcon)
      .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'tray-linux.png'));
    
    await sharp(sourceIcon)
      .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'tray-linux@2x.png'));
    
    console.log('✓ Linux tray icons created\n');
    
    // Generate app icons for electron-builder
    console.log('📦 Generating app icons for builds...\n');
    
    const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
    
    for (const size of sizes) {
      await sharp(sourceIcon)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(outputDir, `icon-${size}x${size}.png`));
    }
    
    console.log('✓ App icons created (16x16 through 1024x1024)');
    
    // Copy for electron-builder
    await sharp(sourceIcon)
      .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'icon.png'));
    
    console.log('✓ Main icon.png created (1024x1024)\n');
    
    console.log('✅ All icons generated successfully!\n');
    console.log('Files created:');
    console.log('  - trayTemplate.png, trayTemplate@2x.png (macOS)');
    console.log('  - tray-windows.png, tray-windows@2x.png (Windows)');
    console.log('  - tray-linux.png, tray-linux@2x.png (Linux)');
    console.log('  - icon.png (1024x1024 for electron-builder)');
    console.log('  - icon-[size].png (various sizes)\n');
    console.log('Note: electron-builder will automatically convert icon.png to:');
    console.log('  - icon.icns (macOS)');
    console.log('  - icon.ico (Windows)');
    
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();
