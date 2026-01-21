// Jest unit tests for app/main/clipboardMonitor.js
// Tests clipboard monitoring logic, deduplication, power optimization, and metrics

jest.mock('electron');

const { clipboard, powerMonitor } = require('electron');
const ClipboardMonitor = require('../app/main/clipboardMonitor');
const StorageManager = require('../app/shared/storage');

describe('ClipboardMonitor', () => {
  let monitor;
  let mockStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock storage
    mockStorage = {
      addItem: jest.fn(() => true),
      getSettings: jest.fn(() => ({
        captureText: true,
        captureRichText: true,
        captureImages: true,
        captureFiles: false
      }))
    };

    // Reset clipboard mocks
    clipboard.readText.mockReturnValue('');
    clipboard.readHTML.mockReturnValue('');
    clipboard.availableFormats.mockReturnValue([]);
    
    monitor = new ClipboardMonitor(mockStorage);
  });

  afterEach(() => {
    if (monitor) {
      monitor.stop();
      monitor.destroy();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      expect(monitor.storageManager).toBe(mockStorage);
      expect(monitor.interval).toBeNull();
      expect(monitor.paused).toBe(false);
      expect(monitor.pollInterval).toBe(500);
    });

    it('should initialize metrics', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.checksPerformed).toBe(0);
      expect(metrics.itemsDetected).toBe(0);
      expect(metrics.duplicatesSkipped).toBe(0);
      expect(metrics.errors).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should start monitoring with setInterval', () => {
      monitor.start();
      expect(monitor.interval).not.toBeNull();
      expect(monitor.cleanupInterval).not.toBeNull();
    });

    it('should not start if already running', () => {
      monitor.start();
      const firstInterval = monitor.interval;
      monitor.start();
      expect(monitor.interval).toBe(firstInterval);
    });

    it('should stop monitoring and clear intervals', () => {
      monitor.start();
      monitor.stop();
      expect(monitor.interval).toBeNull();
      expect(monitor.cleanupInterval).toBeNull();
    });

    it('should handle stop when not running', () => {
      expect(() => monitor.stop()).not.toThrow();
    });
  });

  describe('pause/resume', () => {
    it('should pause monitoring', () => {
      monitor.pause();
      expect(monitor.paused).toBe(true);
    });

    it('should resume monitoring', () => {
      monitor.pause();
      monitor.resume();
      expect(monitor.paused).toBe(false);
    });

    it('should not check clipboard when paused', async () => {
      monitor.pause();
      await monitor.checkClipboard();
      expect(clipboard.readText).not.toHaveBeenCalled();
    });
  });

  describe('checkClipboard', () => {
    it('should detect text clipboard changes', async () => {
      jest.useRealTimers(); // Use real timers for async operations
      
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('test content');
      
      const listener = jest.fn();
      monitor.on('clipboard-change', listener);
      
      await monitor.checkClipboard();
      
      // Wait for nextTick
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(mockStorage.addItem).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          content: 'test content'
        })
      );
      
      jest.useFakeTimers(); // Restore fake timers
    });

    it('should skip duplicate text content', async () => {
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('same content');
      
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      
      expect(mockStorage.addItem).toHaveBeenCalledTimes(1);
      
      const metrics = monitor.getMetrics();
      expect(metrics.duplicatesSkipped).toBe(1);
    });

    it('should detect HTML content when available', async () => {
      jest.useRealTimers();
      
      clipboard.availableFormats.mockReturnValue(['text/html']);
      clipboard.readHTML.mockReturnValue('<p>html content</p>');
      clipboard.readText.mockReturnValue('html content');
      
      mockStorage.getSettings.mockReturnValue({
        captureText: true,
        captureRichText: true,
        captureImages: false
      });
      
      await monitor.checkClipboard();
      
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(mockStorage.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'html',
          content: '<p>html content</p>',
          preview: 'html content'
        })
      );
      
      jest.useFakeTimers();
    });

    it('should respect capture settings', async () => {
      mockStorage.getSettings.mockReturnValue({
        captureText: false,
        captureRichText: true,
        captureImages: false
      });
      
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('text');
      
      await monitor.checkClipboard();
      
      expect(mockStorage.addItem).not.toHaveBeenCalled();
    });

    it('should handle clipboard read errors gracefully', async () => {
      clipboard.availableFormats.mockImplementation(() => {
        throw new Error('Clipboard error');
      });
      
      // Call the safe wrapper that catches errors
      await monitor._safeCheckClipboard();
      
      const metrics = monitor.getMetrics();
      expect(metrics.errors).toBe(1);
    });

    it('should increment checks performed metric', async () => {
      clipboard.availableFormats.mockReturnValue([]);
      
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      
      const metrics = monitor.getMetrics();
      expect(metrics.checksPerformed).toBe(2);
    });
  });

  describe('generatePreview', () => {
    it('should truncate long text', () => {
      const longText = 'a'.repeat(200);
      const preview = monitor.generatePreview(longText);
      expect(preview.length).toBeLessThanOrEqual(103); // 100 + '...'
    });

    it('should return short text as-is', () => {
      const preview = monitor.generatePreview('short');
      expect(preview).toBe('short');
    });

    it('should handle empty string', () => {
      const preview = monitor.generatePreview('');
      expect(preview).toBe('');
    });
  });

  describe('power optimization', () => {
    it('should detect battery power mode', () => {
      powerMonitor.isOnBatteryPower.mockReturnValue(true);
      const mode = monitor._getCurrentPowerMode();
      expect(mode).toBe('battery');
    });

    it('should detect AC power mode', () => {
      powerMonitor.isOnBatteryPower.mockReturnValue(false);
      const mode = monitor._getCurrentPowerMode();
      expect(mode).toBe('ac');
    });

    it('should handle power mode detection errors', () => {
      powerMonitor.isOnBatteryPower.mockImplementation(() => {
        throw new Error('Power error');
      });
      const mode = monitor._getCurrentPowerMode();
      expect(mode).toBe('unknown');
    });
  });

  describe('metrics', () => {
    it('should return comprehensive metrics', async () => {
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText
        .mockReturnValueOnce('first')
        .mockReturnValueOnce('first')
        .mockReturnValueOnce('second');
      
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      
      const metrics = monitor.getMetrics();
      
      expect(metrics).toMatchObject({
        checksPerformed: 3,
        itemsDetected: 2,
        duplicatesSkipped: 1,
        hitRate: expect.any(Number),
        pollInterval: 500
      });
    });

    it('should calculate hit rate correctly', async () => {
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('same');
      
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      await monitor.checkClipboard();
      
      const metrics = monitor.getMetrics();
      expect(metrics.hitRate).toBe(75.00); // 3 duplicates out of 4 checks
    });

    it('should reset metrics', async () => {
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('text');
      
      await monitor.checkClipboard();
      monitor.resetMetrics();
      
      const metrics = monitor.getMetrics();
      expect(metrics.checksPerformed).toBe(0);
      expect(metrics.itemsDetected).toBe(0);
    });
  });

  describe('poll interval management', () => {
    it('should update poll interval', () => {
      monitor.setPollInterval(1000);
      expect(monitor.pollInterval).toBe(1000);
    });

    it('should reject invalid intervals', () => {
      expect(() => monitor.setPollInterval(50)).toThrow();
      expect(() => monitor.setPollInterval(10000)).toThrow();
    });

    it('should restart monitoring with new interval', () => {
      monitor.start();
      const stopSpy = jest.spyOn(monitor, 'stop');
      const startSpy = jest.spyOn(monitor, 'start');
      
      monitor.setPollInterval(1000);
      
      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      monitor.start();
      monitor.enableMonitoring(jest.fn(), 1000);
      
      monitor.destroy();
      
      expect(monitor.interval).toBeNull();
      expect(monitor._metricsReportInterval).toBeNull();
      expect(monitor.removeAllListeners).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle null clipboard content', async () => {
      clipboard.readText.mockReturnValue(null);
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      
      await expect(monitor.checkClipboard()).resolves.not.toThrow();
    });

    it('should handle storage addItem failure', async () => {
      jest.useRealTimers();
      
      mockStorage.addItem.mockReturnValue(false);
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('text');
      
      const listener = jest.fn();
      monitor.on('clipboard-change', listener);
      
      await monitor.checkClipboard();
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(listener).not.toHaveBeenCalled();
      
      jest.useFakeTimers();
    });

    it('should handle whitespace-only content', async () => {
      clipboard.availableFormats.mockReturnValue(['text/plain']);
      clipboard.readText.mockReturnValue('   \n\t  ');
      
      await monitor.checkClipboard();
      
      // The implementation normalizes whitespace but still stores it if it exists
      // This is actually correct behavior - whitespace is valid clipboard content
      expect(mockStorage.addItem).toHaveBeenCalled();
    });
  });
});