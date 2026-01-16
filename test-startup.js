#!/usr/bin/env node

console.log('Testing Clyp startup...');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);

try {
  const electron = require('electron');
  console.log('✓ Electron loaded');
  
  const Store = require('electron-store');
  console.log('✓ electron-store loaded');
  
  const fs = require('fs');
  const path = require('path');
  
  // Check if main files exist
  const mainFile = path.join(__dirname, 'app/main/main.js');
  const trayFile = path.join(__dirname, 'app/main/tray.js');
  const clipboardFile = path.join(__dirname, 'app/main/clipboardMonitor.js');
  
  console.log('Checking files...');
  console.log('  main.js:', fs.existsSync(mainFile) ? '✓' : '✗');
  console.log('  tray.js:', fs.existsSync(trayFile) ? '✓' : '✗');
  console.log('  clipboardMonitor.js:', fs.existsSync(clipboardFile) ? '✓' : '✗');
  
  // Try to load the modules
  console.log('\nLoading modules...');
  try {
    const StorageManager = require('./app/shared/storage');
    console.log('✓ StorageManager loaded');
    
    const TrayManager = require('./app/main/tray');
    console.log('✓ TrayManager loaded');
    
    const ClipboardMonitor = require('./app/main/clipboardMonitor');
    console.log('✓ ClipboardMonitor loaded');
    
    console.log('\n✅ All modules loaded successfully!');
    console.log('\nNow try running: npm start');
    
  } catch (moduleError) {
    console.error('\n❌ Module loading error:', moduleError.message);
    console.error(moduleError.stack);
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
