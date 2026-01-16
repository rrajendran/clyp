const fs = require('fs');
const path = require('path');

// Simple 16x16 PNG - solid black square (for macOS template)
const blackPNG16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNkYGD4z4AEjAIAKpwBAQqCK3QAAAAASUVORK5CYII=',
  'base64'
);

// Simple 16x16 PNG - blue square
const bluePNG16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAF0lEQVR42mNkIBH8py8Y8BowasBIMAAAg0gGAY3FPKcAAAAASUVORK5CYII=',
  'base64'
);

// Write tray icons
fs.writeFileSync(path.join(__dirname, 'trayTemplate.png'), blackPNG16);
fs.writeFileSync(path.join(__dirname, 'trayTemplate@2x.png'), blackPNG16);
fs.writeFileSync(path.join(__dirname, 'tray-windows.png'), bluePNG16);
fs.writeFileSync(path.join(__dirname, 'tray-windows@2x.png'), bluePNG16);
fs.writeFileSync(path.join(__dirname, 'tray-linux.png'), bluePNG16);
fs.writeFileSync(path.join(__dirname, 'tray-linux@2x.png'), bluePNG16);

console.log('✓ Tray icons created successfully!');
console.log('Note: These are placeholder icons. For production, create proper icons.');
