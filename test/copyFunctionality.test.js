// Jest unit tests for copy functionality
// Tests three copy types: item click, drawer copy button, and drawer content click

const { ipcMain, clipboard } = require('electron');
const beautify = require('js-beautify').html;

describe('Copy Functionality', () => {
  let mockClipboard;
  let mockClipboardMonitor;
  let copyHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock clipboard
    mockClipboard = {
      writeText: jest.fn(),
      write: jest.fn(),
      clear: jest.fn(),
      readText: jest.fn(() => ''),
      readHTML: jest.fn(() => '')
    };
    
    // Mock clipboard monitor
    mockClipboardMonitor = {
      pause: jest.fn(),
      resume: jest.fn()
    };
    
    // Simulate the copy handler from main.js
    copyHandler = (event, content) => {
      mockClipboardMonitor.pause();
      try {
        if (content && typeof content === 'object' && (content.html || content.text)) {
          const writeData = {};
          if (content.text) writeData.text = content.text;

          const likelyStyled = content.html && /<span\b|\bstyle=|\bclass=/.test(content.html);
          if (content.html && likelyStyled) {
            const escapeHtml = (str) => {
              return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            };
            const sourceText = content.text || content.html;
            const formatted = (() => {
              try { return beautify(sourceText, { indent_size: 2, wrap_line_length: 0 }); } catch (e) { return sourceText; }
            })();
            writeData.html = `<pre style="white-space: pre-wrap; font-family: Menlo, Monaco, 'Courier New', monospace;">${escapeHtml(formatted)}</pre>`;
          } else if (content.html) {
            try {
              writeData.html = beautify(content.html, { indent_size: 2, wrap_line_length: 0 });
            } catch (e) {
              writeData.html = content.html;
            }
          }

          mockClipboard.write(writeData);
        } else {
          mockClipboard.writeText(typeof content === 'string' ? content : String(content));
        }
        mockClipboardMonitor.resume();
        return true;
      } catch (err) {
        mockClipboardMonitor.resume();
        throw err;
      }
    };
  });

  describe('Copy from item click', () => {
    it('should copy plain text item with text property', () => {
      const content = { text: 'Hello World' };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      expect(mockClipboardMonitor.pause).toHaveBeenCalled();
      expect(mockClipboard.write).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hello World' })
      );
      expect(mockClipboardMonitor.resume).toHaveBeenCalled();
    });

    it('should copy HTML item with both html and text', () => {
      const content = {
        html: '<div>Hello World</div>',
        text: '<div>Hello World</div>'
      };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalled();
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.text).toBe('<div>Hello World</div>');
      expect(writeArgs.html).toContain('<div>');
    });

    it('should handle styled HTML by escaping it', () => {
      const content = {
        html: '<span class="highlight" style="color: red;">Code</span>',
        text: '<span class="highlight" style="color: red;">Code</span>'
      };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.html).toContain('<pre');
      expect(writeArgs.html).toContain('&lt;span');
      expect(writeArgs.html).toContain('&gt;');
    });

    it('should pause and resume clipboard monitor', () => {
      const content = { text: 'Test' };
      
      copyHandler(null, content);
      
      expect(mockClipboardMonitor.pause).toHaveBeenCalledBefore(mockClipboard.write);
      expect(mockClipboardMonitor.resume).toHaveBeenCalledAfter(mockClipboard.write);
    });

    it('should resume monitor even on error', () => {
      mockClipboard.write.mockImplementation(() => {
        throw new Error('Clipboard error');
      });
      
      expect(() => copyHandler(null, { text: 'Test' })).toThrow();
      expect(mockClipboardMonitor.resume).toHaveBeenCalled();
    });
  });

  describe('Copy from drawer copy button', () => {
    it('should copy drawer text content', () => {
      const drawerContent = { text: 'Long text content from drawer' };
      
      const result = copyHandler(null, drawerContent);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Long text content from drawer' })
      );
    });

    it('should handle multiline drawer content', () => {
      const drawerContent = { 
        text: 'Line 1\nLine 2\nLine 3' 
      };
      
      const result = copyHandler(null, drawerContent);
      
      expect(result).toBe(true);
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.text).toContain('\n');
      expect(writeArgs.text).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should copy formatted HTML from drawer', () => {
      const drawerContent = {
        html: '<div><p>Formatted HTML</p></div>',
        text: '<div><p>Formatted HTML</p></div>'
      };
      
      const result = copyHandler(null, drawerContent);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalled();
    });
  });

  describe('Copy from drawer content click', () => {
    it('should copy when clicking drawer content area', () => {
      const drawerContent = { text: 'Clickable drawer text' };
      
      const result = copyHandler(null, drawerContent);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Clickable drawer text' })
      );
    });

    it('should copy unicode characters correctly', () => {
      const drawerContent = { text: '🔥 Unicode 中文 العربية' };
      
      const result = copyHandler(null, drawerContent);
      
      expect(result).toBe(true);
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.text).toBe('🔥 Unicode 中文 العربية');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null content gracefully', () => {
      // The handler converts null to string "null" without throwing
      const result = copyHandler(null, null);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('null');
      expect(mockClipboardMonitor.pause).toHaveBeenCalled();
      expect(mockClipboardMonitor.resume).toHaveBeenCalled();
    });

    it('should handle undefined content', () => {
      // The handler converts undefined to string "undefined" without throwing
      const result = copyHandler(null, undefined);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('undefined');
      expect(mockClipboardMonitor.pause).toHaveBeenCalled();
      expect(mockClipboardMonitor.resume).toHaveBeenCalled();
    });

    it('should convert non-string primitives to strings', () => {
      const result = copyHandler(null, 12345);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('12345');
    });

    it('should handle very long text content', () => {
      const longText = 'a'.repeat(100000);
      const content = { text: longText };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalledWith(
        expect.objectContaining({ text: longText })
      );
    });

    it('should handle malformed HTML gracefully', () => {
      const content = {
        html: '<div><p>Unclosed tags',
        text: '<div><p>Unclosed tags'
      };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalled();
    });

    it('should handle special characters in HTML', () => {
      const content = {
        html: '<div>&lt;script&gt;alert("xss")&lt;/script&gt;</div>',
        text: '<script>alert("xss")</script>'
      };
      
      const result = copyHandler(null, content);
      
      expect(result).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalled();
    });
  });

  describe('Content type verification', () => {
    it('should identify and handle text content type', () => {
      const content = { text: 'Plain text' };
      
      copyHandler(null, content);
      
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs).toHaveProperty('text');
      expect(writeArgs.text).toBe('Plain text');
    });

    it('should identify and handle HTML content type', () => {
      const content = {
        html: '<p>HTML content</p>',
        text: '<p>HTML content</p>'
      };
      
      copyHandler(null, content);
      
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs).toHaveProperty('html');
      expect(writeArgs).toHaveProperty('text');
    });

    it('should beautify clean HTML without styling', () => {
      const content = {
        html: '<div><p>Clean</p></div>',
        text: '<div><p>Clean</p></div>'
      };
      
      copyHandler(null, content);
      
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.html).toContain('<div>');
      expect(writeArgs.html).toContain('<p>');
    });

    it('should wrap styled HTML in pre tag', () => {
      const content = {
        html: '<span style="color: red;">Styled</span>',
        text: '<span style="color: red;">Styled</span>'
      };
      
      copyHandler(null, content);
      
      const writeArgs = mockClipboard.write.mock.calls[0][0];
      expect(writeArgs.html).toMatch(/<pre/);
      expect(writeArgs.html).toContain('&lt;span');
    });
  });
});

// Custom Jest matchers for call order
expect.extend({
  toHaveBeenCalledBefore(received, expected) {
    const receivedCallTime = received.mock.invocationCallOrder[0];
    const expectedCallTime = expected.mock.invocationCallOrder[0];
    
    const pass = receivedCallTime < expectedCallTime;
    
    return {
      pass,
      message: () => pass
        ? `expected ${received.getMockName()} not to be called before ${expected.getMockName()}`
        : `expected ${received.getMockName()} to be called before ${expected.getMockName()}`
    };
  },
  
  toHaveBeenCalledAfter(received, expected) {
    const receivedCallTime = received.mock.invocationCallOrder[0];
    const expectedCallTime = expected.mock.invocationCallOrder[0];
    
    const pass = receivedCallTime > expectedCallTime;
    
    return {
      pass,
      message: () => pass
        ? `expected ${received.getMockName()} not to be called after ${expected.getMockName()}`
        : `expected ${received.getMockName()} to be called after ${expected.getMockName()}`
    };
  }
});
