const { clipboard, nativeImage, powerMonitor } = require('electron');
const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');

// Constants for optimization
const DEFAULT_POLL_INTERVAL = 500;
const BATTERY_POLL_INTERVAL = 1500; // Slower polling when on battery
const MAX_PREVIEW_LENGTH = 100;
const IMAGE_HASH_SAMPLE_SIZE = 1024; // Only hash first 1KB of images for speed
const CLEANUP_INTERVAL = 60000; // Run cleanup every 60 seconds
const METRICS_REPORT_INTERVAL = 60000; // Report metrics every 60 seconds

class ClipboardMonitor extends EventEmitter {
  constructor(storageManager) {
    super();
    this.storageManager = storageManager;
    this.interval = null;
    this.cleanupInterval = null;
    this.lastHash = null;
    this.paused = false;
    this.pollInterval = DEFAULT_POLL_INTERVAL;
    
    // Cache for performance
    this._cachedFormats = null;
    this._formatsCacheTime = 0;
    this._formatsCacheTTL = 100; // Cache formats for 100ms
    
    // Pre-compiled regex patterns (avoid recompilation)
    this._htmlTagRegex = /<[^>]*>/g;
    this._htmlDetectRegex = /<[^>]*>/;
    this._whitespaceRegex = /\s+/g;
    
    // Metrics for monitoring (optional)
    this._metrics = {
      checksPerformed: 0,
      itemsDetected: 0,
      duplicatesSkipped: 0,
      errors: 0
    };
    
    // Bind methods to avoid creating new closures
    this._boundCheckClipboard = this._safeCheckClipboard.bind(this);
    this._boundCleanup = this._performCleanup.bind(this);
    this._boundOnBattery = this._handleBatteryMode.bind(this);
    this._boundOnAC = this._handleACMode.bind(this);
    
    // Battery optimization
    this._batteryOptimizationEnabled = true;
    this._defaultPollInterval = DEFAULT_POLL_INTERVAL;
    this._batteryPollInterval = BATTERY_POLL_INTERVAL;
    
    // Monitoring configuration
    this._monitoringEnabled = false;
    this._metricsReportInterval = null;
    this._metricsCallback = null;
    
    // Set max listeners to prevent memory leak warnings
    this.setMaxListeners(10);
    
    // Initialize power monitoring
    this._initializePowerMonitoring();
    
    const iconPath = path.join(__dirname, '../assets/icons/png/icon.png'); // Update path to dock icon
  }

  /**
   * Initialize power monitoring for battery optimization
   */
  _initializePowerMonitoring() {
    if (!this._batteryOptimizationEnabled) return;
    
    try {
      // Check if we're on battery initially
      if (powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()) {
        this.pollInterval = this._batteryPollInterval;
        console.log('ClipboardMonitor: Starting on battery power, using slower poll interval:', this.pollInterval);
      }
      
      // Listen for power state changes
      powerMonitor.on('on-battery', this._boundOnBattery);
      powerMonitor.on('on-ac', this._boundOnAC);
    } catch (error) {
      console.warn('ClipboardMonitor: Failed to initialize power monitoring:', error.message);
      // Continue without battery optimization
    }
  }

  /**
   * Handle switching to battery power
   */
  _handleBatteryMode() {
    if (!this._batteryOptimizationEnabled) return;
    
    console.log('ClipboardMonitor: Switched to battery power, reducing poll frequency');
    this.setPollInterval(this._batteryPollInterval);
    
    // Emit event for external monitoring
    this.emit('power-mode-changed', { mode: 'battery', interval: this._batteryPollInterval });
  }

  /**
   * Handle switching to AC power
   */
  _handleACMode() {
    if (!this._batteryOptimizationEnabled) return;
    
    console.log('ClipboardMonitor: Switched to AC power, increasing poll frequency');
    this.setPollInterval(this._defaultPollInterval);
    
    // Emit event for external monitoring
    this.emit('power-mode-changed', { mode: 'ac', interval: this._defaultPollInterval });
  }
  /**
   * Detect clipboard content type (optimized with caching)
   */
  async detectClipboardItem() {
    const now = Date.now();
    let formats;
    
    // Cache clipboard formats for short duration to avoid repeated native calls
    if (this._cachedFormats && (now - this._formatsCacheTime) < this._formatsCacheTTL) {
      formats = this._cachedFormats;
    } else {
      formats = clipboard.availableFormats();
      // console.log('Detected clipboard formats:', formats);
      this._cachedFormats = formats;
      this._formatsCacheTime = now;
    }
    // 1. Plain text (prefer plain text first)
    if (formats.includes('text/plain')) {
      return { type: 'text', mime: 'text/plain' };
    }

    // 2. Image
    if (formats.some(f => f.startsWith('image/'))) {
      return { type: 'image', mime: formats.find(f => f.startsWith('image/')) };
    }

    // 3. HTML
    if (formats.includes('text/html')) {
      // By default prefer preserving HTML clipboard flavor so pasted content
      // retains formatting exactly as copied. For backward-compatibility and
      // deduping, a setting `preserveHtmlFormatting` can be set to `false`
      // (via `storageManager.getSettings()`) to restore the previous behavior
      // that prefers plain text when the visible HTML text matches the
      // plain text flavor.
      const settings = this.storageManager && typeof this.storageManager.getSettings === 'function'
        ? this.storageManager.getSettings() || {}
        : {};

      // If the user explicitly disabled preserving HTML, run the old
      // comparison logic to possibly prefer plain text when they are
      // semantically identical. Otherwise, preserve HTML flavor.
      if (settings.preserveHtmlFormatting === false && formats.includes('text/plain')) {
        try {
          const plain = clipboard.readText();
          const html = clipboard.readHTML();
          if (html && plain) {
            const visible = this.normalizeText(this.stripHtml(html));
            const normalizedPlain = this.normalizeText(plain);
            if (visible === normalizedPlain) {
              return { type: 'text', mime: 'text/plain' };
            }
          }
        } catch (e) {
          // If reading fails, fall back to treating as HTML
        }
      }

      return { type: 'html', mime: 'text/html' };
    }

    // 4. Video (common video clipboard formats may be raw file paths or specific types)
    if (formats.some(f => f.startsWith('video/'))) {
      return { type: 'video', mime: formats.find(f => f.startsWith('video/')) };
    }

    // 5. Files
    if (formats.includes('application/octet-stream')) {
      // Treat as file list / generic blob
      return { type: 'file', mime: 'application/octet-stream' };
    }

    return { type: 'unknown', mime: null };
  }

  /**
   * Simple HTML detection (optimized with pre-compiled regex)
   */
  isHtml(text) {
    if (!text || text.length < 3) return false;
    return this._htmlDetectRegex.test(text) && (text.includes('<html') || text.includes('<body') || text.includes('<div'));
  }

  /**
   * Normalize text for hashing/comparison (optimized)
   */
  normalizeText(text) {
    if (!text) return '';
    // Use cached regex and avoid unnecessary toString() for strings
    const str = typeof text === 'string' ? text : text.toString();
    return str.trim().replace(this._whitespaceRegex, ' ');
  }
  /**
   * Start monitoring clipboard (optimized with error handling)
   */
  start() {
    if (this.interval) return;

    // Get initial clipboard state
    this.initializeLastState();

    // Use bound method to avoid closure creation on every interval
    this.interval = setInterval(this._boundCheckClipboard, this.pollInterval);
    
    // Start periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(this._boundCleanup, CLEANUP_INTERVAL);

    console.log('Clipboard monitoring started with interval:', this.pollInterval);
  }

  /**
   * Initialize last state
   */
  initializeLastState() {
    // Simple initialization
    this.lastHash = null;
  }

  /**
   * Stop monitoring clipboard (with proper cleanup)
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clear caches to free memory
    this._cachedFormats = null;
    this._formatsCacheTime = 0;
    
    // Stop monitoring metrics reporting
    if (this._metricsReportInterval) {
      clearInterval(this._metricsReportInterval);
      this._metricsReportInterval = null;
    }
    
    console.log('Clipboard monitoring stopped');
  }

  /**
   * Clean up all resources and listeners
   */
  destroy() {
    this.stop();
    
    // Remove power monitor listeners
    try {
      powerMonitor.removeListener('on-battery', this._boundOnBattery);
      powerMonitor.removeListener('on-ac', this._boundOnAC);
    } catch (error) {
      // Ignore errors during cleanup
    }
    
    // Remove all event listeners
    this.removeAllListeners();
    
    console.log('ClipboardMonitor: Destroyed and cleaned up');
  }

  /**
   * Pause monitoring temporarily
   */
  pause() {
    this.paused = true;
  }

  /**
   * Resume monitoring
   */
  resume() {
    this.paused = false;
  }

  /**
   * Safe wrapper for checkClipboard with error handling
   */
  async _safeCheckClipboard() {
    try {
      await this.checkClipboard();
    } catch (error) {
      this._metrics.errors++;
      console.error('ClipboardMonitor: Error in checkClipboard:', error.message);
      // Don't stop monitoring on errors, just log and continue
    }
  }
  
  /**
   * Check clipboard for changes (optimized)
   */
  async checkClipboard() {
    if (this.paused) return;
    
    this._metrics.checksPerformed++;

    // Cache settings call result to avoid repeated lookups
    const settings = this.storageManager.getSettings();
    const item = await this.detectClipboardItem();

    if (item.type === 'text' && settings.captureText !== false) {
      const text = clipboard.readText();
      if (text) {
        const normalized = this.normalizeText(text);
        const hash = this.hashContent('text:' + normalized);
        if (hash !== this.lastHash) {
          this.handleNewContent({
            type: 'text',
            content: text,
            preview: this.generatePreview(normalized)
          });
          this.lastHash = hash;
          this._metrics.itemsDetected++;
          return;
        } else {
          this._metrics.duplicatesSkipped++;
        }
      }
    } else if (item.type === 'image' && settings.captureImages !== false) {
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const imageData = image.toPNG();
        // Optimize: Only hash a sample of large images for faster comparison
        const sampleData = imageData.length > IMAGE_HASH_SAMPLE_SIZE 
          ? imageData.slice(0, IMAGE_HASH_SAMPLE_SIZE)
          : imageData;
        const hash = this.hashContent(sampleData);
        
        if (hash !== this.lastHash) {
          const size = image.getSize();
          this.handleNewContent({
            type: 'image',
            content: image.toDataURL(),
            preview: `Image (${size.width}x${size.height})`,
            size
          });
          this.lastHash = hash;
          this._metrics.itemsDetected++;
          return;
        } else {
          this._metrics.duplicatesSkipped++;
        }
      }
    } else if (item.type === 'html' && settings.captureRichText !== false) {
      const html = clipboard.readHTML();
      if (html) {
        // Preserve the original HTML content so paste operations reproduce the
        // formatting exactly as copied. For deduplication, compute both a
        // canonical text hash (visible text) and an HTML hash; prefer storing
        // the HTML content but compare against the visible text hash so plain
        // text copies that match the visible HTML won't create duplicates.
        const stripped = this.stripHtml(html);
        const normalized = this.normalizeText(stripped);
        const visibleHash = this.hashContent('text:' + normalized);
        const htmlHash = this.hashContent('html:' + html);

        // If either visible text or exact HTML differs from last stored hash,
        // accept it. We set lastHash to the htmlHash so repeated identical
        // HTML content doesn't re-add. This still prevents storing both plain
        // text and same visible HTML as separate entries because visibleHash
        // is compared as well.
        if (visibleHash !== this.lastHash && htmlHash !== this.lastHash) {
          this.handleNewContent({
            type: 'html',
            content: html,
            preview: this.generatePreview(normalized)
          });
          this.lastHash = htmlHash;
          this._metrics.itemsDetected++;
          return;
        } else {
          this._metrics.duplicatesSkipped++;
        }
      }
    } else if (item.type === 'video') {
      // Basic video handling: many platforms put file paths into the clipboard
      // as plain file lists/blobs. Attempt to read available file paths using
      // the native clipboard APIs if possible. Electron doesn't provide a
      // direct `readVideo` API, so we treat video like files for now.
      try {
        // Try reading raw text first (some systems put a file path as text)
        const possiblePath = clipboard.readText();
        if (possiblePath && (possiblePath.endsWith('.mp4') || possiblePath.endsWith('.mov') || possiblePath.endsWith('.m4v') || possiblePath.endsWith('.webm'))) {
          const hash = this.hashContent('file:' + possiblePath);
          if (hash !== this.lastHash) {
            this.handleNewContent({
              type: 'video',
              content: possiblePath,
              preview: `Video (${possiblePath.split('/').pop()})`
            });
            this.lastHash = hash;
            this._metrics.itemsDetected++;
            return;
          } else {
            this._metrics.duplicatesSkipped++;
          }
        }
      } catch (e) {
        // Fallthrough to file handling
      }
    }

    // Files handled as a final fallback
    if (item.type === 'file') {
      // Treat generic file blobs as file list entries. Attempt to read
      // textual file path representations; otherwise store as a generic file
      // entry with minimal metadata.
      try {
        const possible = clipboard.readText();
        const hash = this.hashContent('file:' + possible);
        if (hash !== this.lastHash) {
          this.handleNewContent({
            type: 'file',
            content: possible || '',
            preview: possible ? possible.split('/').pop() : 'File'
          });
          this.lastHash = hash;
          this._metrics.itemsDetected++;
          return;
        } else {
          this._metrics.duplicatesSkipped++;
        }
      } catch (error) {
        // ignore and continue
      }
    }
  }

  /**
   * Handle new clipboard content (optimized)
   */
  handleNewContent(data) {
    const timestamp = Date.now();
    const item = {
      id: timestamp.toString(),
      timestamp,
      ...data,
      pinned: false,
      tags: []
    };

    try {
      const wasAdded = this.storageManager.addItem(item);
      if (wasAdded) {
        // Emit asynchronously to avoid blocking
        process.nextTick(() => {
          this.emit('clipboard-change', item);
        });
      }
    } catch (error) {
      console.error('ClipboardMonitor: Failed to add item:', error.message);
      this._metrics.errors++;
    }
  }

  /**
   * Generate content hash for deduplication (optimized)
   * Uses xxHash-like simple hash for speed instead of MD5
   */
  hashContent(content) {
    // For clipboard deduplication, we don't need cryptographic security
    // A simple fast hash is sufficient and much faster than MD5
    const str = typeof content === 'string' ? content : content.toString();
    let hash = 0;
    
    // Simple but fast hash algorithm (similar to Java's String.hashCode)
    for (let i = 0, len = Math.min(str.length, 10000); i < len; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return hash.toString(36); // Base36 for shorter strings
  }

  /**
   * Generate preview text (optimized)
   */
  generatePreview(text, maxLength = MAX_PREVIEW_LENGTH) {
    if (!text) return '';
    
    // Avoid regex if text is short enough
    if (text.length <= maxLength) {
      return text.trim().replace(this._whitespaceRegex, ' ');
    }
    
    // For long text, truncate first then clean
    const truncated = text.substring(0, maxLength + 50); // Extra buffer for whitespace collapse
    const cleaned = truncated.trim().replace(this._whitespaceRegex, ' ');
    
    return cleaned.length > maxLength 
      ? cleaned.substring(0, maxLength) + '...' 
      : cleaned;
  }

  /**
   * Strip HTML tags for preview (optimized)
   */
  stripHtml(html) {
    if (!html) return '';
    // Use pre-compiled regex and avoid unnecessary operations
    return html.replace(this._htmlTagRegex, '').trim();
  }
  
  /**
   * Periodic cleanup to prevent memory leaks
   */
  _performCleanup() {
    // Clear format cache periodically
    this._cachedFormats = null;
    this._formatsCacheTime = 0;
    
    // Report metrics if callback is configured
    if (this._monitoringEnabled && this._metricsCallback) {
      try {
        const metrics = this.getMetrics();
        this._metricsCallback(metrics);
      } catch (error) {
        console.error('ClipboardMonitor: Error in metrics callback:', error.message);
      }
    }
    
    // Log metrics for monitoring (optional, can be removed in production)
    if (this._metrics.checksPerformed > 0) {
      const hitRate = this._metrics.checksPerformed > 0
        ? ((this._metrics.duplicatesSkipped / this._metrics.checksPerformed) * 100).toFixed(1)
        : '0.0';
      console.log('ClipboardMonitor metrics:', {
        checks: this._metrics.checksPerformed,
        items: this._metrics.itemsDetected,
        duplicates: this._metrics.duplicatesSkipped,
        hitRate: `${hitRate}%`,
        errors: this._metrics.errors,
        pollInterval: this.pollInterval,
        powerMode: this._getCurrentPowerMode()
      });
    }
  }

  /**
   * Get current power mode
   */
  _getCurrentPowerMode() {
    try {
      return powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower() ? 'battery' : 'ac';
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Get current metrics (for monitoring/debugging)
   */
  getMetrics() {
    const hitRate = this._metrics.checksPerformed > 0
      ? ((this._metrics.duplicatesSkipped / this._metrics.checksPerformed) * 100).toFixed(2)
      : 0;
    
    return {
      ...this._metrics,
      hitRate: parseFloat(hitRate),
      pollInterval: this.pollInterval,
      powerMode: this._getCurrentPowerMode(),
      batteryOptimizationEnabled: this._batteryOptimizationEnabled,
      monitoringEnabled: this._monitoringEnabled,
      uptime: this.interval ? 'running' : 'stopped'
    };
  }

  /**
   * Get formatted metrics for external monitoring systems
   * @returns {Object} Metrics in a format suitable for StatsD, Prometheus, etc.
   */
  getFormattedMetrics() {
    const metrics = this.getMetrics();
    return {
      'clipboard.monitor.checks.total': metrics.checksPerformed,
      'clipboard.monitor.items.detected': metrics.itemsDetected,
      'clipboard.monitor.duplicates.skipped': metrics.duplicatesSkipped,
      'clipboard.monitor.errors.total': metrics.errors,
      'clipboard.monitor.hit_rate.percent': metrics.hitRate,
      'clipboard.monitor.poll_interval.ms': metrics.pollInterval,
      'clipboard.monitor.power_mode': metrics.powerMode === 'battery' ? 1 : 0,
      'clipboard.monitor.status': metrics.uptime === 'running' ? 1 : 0
    };
  }
  
  /**
   * Reset metrics
   */
  resetMetrics() {
    this._metrics = {
      checksPerformed: 0,
      itemsDetected: 0,
      duplicatesSkipped: 0,
      errors: 0
    };
  }
  
  /**
   * Update poll interval dynamically
   */
  setPollInterval(interval) {
    if (interval < 100 || interval > 5000) {
      throw new Error('Poll interval must be between 100ms and 5000ms');
    }
    
    this.pollInterval = interval;
    
    // Restart monitoring with new interval if currently running
    if (this.interval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Enable or disable battery optimization
   * @param {boolean} enabled - Whether to enable battery optimization
   */
  setBatteryOptimization(enabled) {
    this._batteryOptimizationEnabled = enabled;
    
    if (enabled) {
      this._initializePowerMonitoring();
      // Apply current power state
      try {
        if (powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()) {
          this._handleBatteryMode();
        } else {
          this._handleACMode();
        }
      } catch (error) {
        console.warn('ClipboardMonitor: Failed to check power state:', error.message);
      }
    } else {
      // Reset to default interval
      this.setPollInterval(this._defaultPollInterval);
    }
    
    console.log('ClipboardMonitor: Battery optimization', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Configure custom poll intervals for battery and AC modes
   * @param {number} acInterval - Poll interval when on AC power (ms)
   * @param {number} batteryInterval - Poll interval when on battery (ms)
   */
  configurePowerModeIntervals(acInterval, batteryInterval) {
    if (acInterval < 100 || acInterval > 5000) {
      throw new Error('AC interval must be between 100ms and 5000ms');
    }
    if (batteryInterval < 100 || batteryInterval > 5000) {
      throw new Error('Battery interval must be between 100ms and 5000ms');
    }
    
    this._defaultPollInterval = acInterval;
    this._batteryPollInterval = batteryInterval;
    
    console.log('ClipboardMonitor: Configured poll intervals - AC:', acInterval, 'Battery:', batteryInterval);
    
    // Apply current power state if battery optimization is enabled
    if (this._batteryOptimizationEnabled && this.interval) {
      try {
        if (powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()) {
          this.setPollInterval(batteryInterval);
        } else {
          this.setPollInterval(acInterval);
        }
      } catch (error) {
        console.warn('ClipboardMonitor: Failed to apply power mode intervals:', error.message);
      }
    }
  }

  /**
   * Enable monitoring integration with metrics callback
   * @param {Function} callback - Function to call with metrics (receives metrics object)
   * @param {number} reportInterval - How often to report metrics in ms (default: 60000)
   */
  enableMonitoring(callback, reportInterval = METRICS_REPORT_INTERVAL) {
    if (typeof callback !== 'function') {
      throw new Error('Metrics callback must be a function');
    }
    
    this._monitoringEnabled = true;
    this._metricsCallback = callback;
    
    // Set up periodic metrics reporting
    if (this._metricsReportInterval) {
      clearInterval(this._metricsReportInterval);
    }
    
    this._metricsReportInterval = setInterval(() => {
      try {
        const metrics = this.getMetrics();
        callback(metrics);
      } catch (error) {
        console.error('ClipboardMonitor: Error in metrics reporting:', error.message);
      }
    }, reportInterval);
    
    console.log('ClipboardMonitor: Monitoring enabled with', reportInterval, 'ms report interval');
  }

  /**
   * Disable monitoring integration
   */
  disableMonitoring() {
    this._monitoringEnabled = false;
    this._metricsCallback = null;
    
    if (this._metricsReportInterval) {
      clearInterval(this._metricsReportInterval);
      this._metricsReportInterval = null;
    }
    
    console.log('ClipboardMonitor: Monitoring disabled');
  }
}

module.exports = ClipboardMonitor;
