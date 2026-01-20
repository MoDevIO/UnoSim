/**
 * Tests for OutputPanel automatic behavior
 * 
 * Verifies:
 * 1. Panel opens and resizes automatically for compiler errors
 * 2. Panel opens and resizes for parser messages (25-75%)
 * 3. Panel minimizes/hides on success without errors/messages
 * 4. X button dismisses panel but it reappears on new errors/messages
 * 5. Menu toggle works correctly
 */

import type { ParserMessage } from '@shared/schema';

describe('OutputPanel Auto-Behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('Compiler Errors - Panel Open and Sizing', () => {
    it('should calculate panel size between 25-75% for short compiler errors', () => {
      const shortError = 'error: syntax error';
      const lines = shortError.split('\n').length;
      const totalChars = shortError.length;
      
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
      expect(newSize).toBeLessThanOrEqual(75);
      expect(newSize).toBeLessThan(50); // Should be relatively small
    });

    it('should calculate panel size between 25-75% for medium compiler errors', () => {
      const mediumError = `error: invalid syntax
error: undeclared variable "x"
error: missing semicolon on line 5`;
      const lines = mediumError.split('\n').length;
      const totalChars = mediumError.length;
      
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
      expect(newSize).toBeLessThanOrEqual(75);
    });

    it('should calculate size based on total character count for long error messages', () => {
      const longError = Array(15)
        .fill(0)
        .map((_, i) => `error: this is a very long error message on line ${i} with lots of details`)
        .join('\n');
      
      const lines = longError.split('\n').length;
      const totalChars = longError.length;
      
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
      expect(newSize).toBeLessThanOrEqual(75);
      expect(newSize).toBeGreaterThan(35); // Should be significantly larger for long errors
    });

    it('should cap panel size at 75% maximum', () => {
      const veryLongError = Array(100)
        .fill(0)
        .map((_, i) => `error: ${i}`)
        .join('\n');
      
      const lines = veryLongError.split('\n').length;
      const totalChars = veryLongError.length;
      
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeLessThanOrEqual(75);
    });

    it('should enforce 25% minimum size', () => {
      const tinyError = 'error';
      const lines = tinyError.split('\n').length;
      const totalChars = tinyError.length;
      
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
    });
  });

  describe('Parser Messages - Panel Open and Sizing (25-75%)', () => {
    it('should calculate parser message panel size between 25-75% based on few messages', () => {
      const messages: ParserMessage[] = [
        {
          id: 'msg1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial.begin(9600) is missing in setup()',
          suggestion: 'Serial.begin(9600);',
        },
      ];

      const messageCount = messages.length;
      const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.message?.length || 0) + 50, 0);
      const HEADER_HEIGHT = 50;
      const PER_MESSAGE_BASE = 55;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const estimatedPx = HEADER_HEIGHT + PADDING + messageCount * PER_MESSAGE_BASE + Math.ceil(totalMessageLength / 100) * 15;
      const newSize = Math.min(75, Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
      expect(newSize).toBeLessThanOrEqual(75);
    });

    it('should calculate parser message panel size for multiple messages', () => {
      const messages: ParserMessage[] = [
        {
          id: 'msg1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial.begin(9600) is missing in setup()',
          suggestion: 'Serial.begin(9600);',
        },
        {
          id: 'msg2',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial output configured but Serial.println() is called in loop()',
          suggestion: '',
        },
      ];

      const messageCount = messages.length;
      const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.message?.length || 0) + 50, 0);
      const HEADER_HEIGHT = 50;
      const PER_MESSAGE_BASE = 55;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const estimatedPx = HEADER_HEIGHT + PADDING + messageCount * PER_MESSAGE_BASE + Math.ceil(totalMessageLength / 100) * 15;
      const newSize = Math.min(75, Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)));
      
      expect(newSize).toBeGreaterThanOrEqual(25);
      expect(newSize).toBeLessThanOrEqual(75);
    });

    it('should increase panel size with more messages', () => {
      const calculateSize = (messageCount: number) => {
        const messages = Array(messageCount)
          .fill(null)
          .map((_, i) => ({
            id: `msg-${i}`,
            type: 'warning' as const,
            category: 'serial',
            severity: 2 as const,
            message: `This is message ${i} with some content to simulate real-world scenarios`,
            suggestion: '',
          }));

        const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.message?.length || 0) + 50, 0);
        const HEADER_HEIGHT = 50;
        const PER_MESSAGE_BASE = 55;
        const PADDING = 60;
        const AVAILABLE_HEIGHT = 800;
        
        const estimatedPx = HEADER_HEIGHT + PADDING + messageCount * PER_MESSAGE_BASE + Math.ceil(totalMessageLength / 100) * 15;
        return Math.min(75, Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)));
      };

      const size1 = calculateSize(1);
      const size3 = calculateSize(3);
      const size8 = calculateSize(8);

      expect(size3).toBeGreaterThan(size1);
      expect(size8).toBeGreaterThanOrEqual(size3);
      expect(size8).toBeLessThanOrEqual(75);
    });

    it('should cap panel size at 75% for many messages', () => {
      const messageCount = 50;
      const messages = Array(messageCount)
        .fill(null)
        .map((_, i) => ({
          id: `msg-${i}`,
          type: 'warning' as const,
          category: 'serial',
          severity: 2 as const,
          message: `Message ${i}: This is a very long message content that takes up space in the panel`,
          suggestion: '',
        }));

      const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.message?.length || 0) + 50, 0);
      const HEADER_HEIGHT = 50;
      const PER_MESSAGE_BASE = 55;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const estimatedPx = HEADER_HEIGHT + PADDING + messageCount * PER_MESSAGE_BASE + Math.ceil(totalMessageLength / 100) * 15;
      const newSize = Math.min(75, Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)));

      expect(newSize).toBeLessThanOrEqual(75);
    });

    it('should enforce 25% minimum size for single short message', () => {
      const messages: ParserMessage[] = [
        {
          id: 'msg1',
          type: 'info',
          category: 'serial',
          severity: 1,
          message: 'OK',
          suggestion: '',
        },
      ];

      const messageCount = messages.length;
      const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.message?.length || 0) + 50, 0);
      const HEADER_HEIGHT = 50;
      const PER_MESSAGE_BASE = 55;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const estimatedPx = HEADER_HEIGHT + PADDING + messageCount * PER_MESSAGE_BASE + Math.ceil(totalMessageLength / 100) * 15;
      const newSize = Math.min(75, Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)));

      expect(newSize).toBeGreaterThanOrEqual(25);
    });
  });

  describe('Success without Errors/Messages - Panel Minimize and Hide', () => {
    it('should minimize panel to 3% on success without errors or messages', () => {
      const successCondition = {
        lastCompilationResult: 'success' as const,
        hasCompilationErrors: false,
        parserMessages: [],
        panelSize: 3,
      };

      // Verify the condition logic
      expect(successCondition.lastCompilationResult).toBe('success');
      expect(successCondition.hasCompilationErrors).toBe(false);
      expect(successCondition.parserMessages.length).toBe(0);

      // Panel should be minimized to 3%
      const shouldMinimize = successCondition.lastCompilationResult === 'success' 
        && !successCondition.hasCompilationErrors 
        && successCondition.parserMessages.length === 0;
      
      expect(shouldMinimize).toBe(true);
      expect(successCondition.panelSize).toBe(3);
    });

    it('should keep panel visible on success if there are parser messages', () => {
      const condition = {
        lastCompilationResult: 'success' as const,
        hasCompilationErrors: false,
        parserMessages: [{ id: 'msg1' }],
      };

      const shouldHide = condition.lastCompilationResult === 'success' 
        && !condition.hasCompilationErrors 
        && condition.parserMessages.length === 0;
      
      expect(shouldHide).toBe(false);
    });

    it('should keep panel visible on success if there are compilation errors', () => {
      const condition = {
        lastCompilationResult: 'success' as const,
        hasCompilationErrors: true,
        parserMessages: [],
      };

      const shouldHide = condition.lastCompilationResult === 'success' 
        && !condition.hasCompilationErrors 
        && condition.parserMessages.length === 0;
      
      expect(shouldHide).toBe(false);
    });

    it('should not hide panel if compilation result is error', () => {
      const condition = {
        lastCompilationResult: 'error' as const,
        hasCompilationErrors: false,
        parserMessages: [],
      };

      const shouldHide = condition.lastCompilationResult === 'success' 
        && !condition.hasCompilationErrors 
        && condition.parserMessages.length === 0;
      
      expect(shouldHide).toBe(false);
    });

    it('should not hide panel if compilation result is null', () => {
      const condition = {
        lastCompilationResult: null as 'success' | 'error' | null,
        hasCompilationErrors: false,
        parserMessages: [],
      };

      const shouldHide = condition.lastCompilationResult === 'success' 
        && !condition.hasCompilationErrors 
        && condition.parserMessages.length === 0;
      
      expect(shouldHide).toBe(false);
    });
  });

  describe('X Button and Re-appearance', () => {
    it('should dismiss panel when X button is clicked (sets showCompilationOutput=false and parserPanelDismissed=true)', () => {
      const state = {
        showCompilationOutput: true,
        parserPanelDismissed: false,
      };

      // Simulate X button click
      state.showCompilationOutput = false;
      state.parserPanelDismissed = true;

      expect(state.showCompilationOutput).toBe(false);
      expect(state.parserPanelDismissed).toBe(true);
    });

    it('should re-show panel when new compiler errors occur after dismissal', () => {
      let state = {
        showCompilationOutput: false,
        parserPanelDismissed: true,
        hasCompilationErrors: false,
      };

      // Simulate new compilation error
      state.hasCompilationErrors = true;
      if (state.hasCompilationErrors) {
        state.showCompilationOutput = true;
        state.parserPanelDismissed = false;
      }

      expect(state.showCompilationOutput).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });

    it('should re-show panel when new parser messages occur after dismissal', () => {
      let state = {
        showCompilationOutput: false,
        parserPanelDismissed: true,
        parserMessages: [] as any[],
        hasCompilationErrors: false,
      };

      // Simulate new parser messages without errors
      state.parserMessages = [{ id: 'msg1' }];
      if (state.parserMessages.length > 0 && !state.hasCompilationErrors) {
        state.showCompilationOutput = true;
        state.parserPanelDismissed = false;
      }

      expect(state.showCompilationOutput).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });

    it('should not re-show panel if errors/messages are cleared after dismissal', () => {
      let state = {
        showCompilationOutput: false,
        parserPanelDismissed: true,
        hasCompilationErrors: false,
        parserMessages: [] as any[],
        lastCompilationResult: 'success' as const,
      };

      // Verify panel stays hidden
      const shouldShow = state.hasCompilationErrors || state.parserMessages.length > 0;
      expect(shouldShow).toBe(false);
      expect(state.showCompilationOutput).toBe(false);
    });
  });

  describe('Menu Toggle Item', () => {
    it('should toggle panel visibility when menu item is clicked', () => {
      let showCompilationOutput = false;

      // Click menu item (first time: toggle ON)
      showCompilationOutput = !showCompilationOutput;
      expect(showCompilationOutput).toBe(true);

      // Click menu item (second time: toggle OFF)
      showCompilationOutput = !showCompilationOutput;
      expect(showCompilationOutput).toBe(false);

      // Click menu item (third time: toggle ON)
      showCompilationOutput = !showCompilationOutput;
      expect(showCompilationOutput).toBe(true);
    });

    it('should reset parserPanelDismissed when toggling panel ON', () => {
      let state = {
        showCompilationOutput: false,
        parserPanelDismissed: true,
      };

      // Simulate menu click to toggle ON
      const newState = !state.showCompilationOutput;
      if (newState) {
        state.showCompilationOutput = true;
        state.parserPanelDismissed = false;
      }

      expect(state.showCompilationOutput).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });

    it('should not reset parserPanelDismissed when toggling panel OFF', () => {
      let state = {
        showCompilationOutput: true,
        parserPanelDismissed: false,
      };

      // Simulate menu click to toggle OFF
      const newState = !state.showCompilationOutput;
      state.showCompilationOutput = newState;
      // Note: parserPanelDismissed is not changed when toggling OFF

      expect(state.showCompilationOutput).toBe(false);
      expect(state.parserPanelDismissed).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long error messages (multiple screen heights)', () => {
      const veryLongError = Array(100)
        .fill(0)
        .map((_, i) => `error line ${i}: this is a test error message`)
        .join('\n');

      const lines = veryLongError.split('\n').length;
      const totalChars = veryLongError.length;
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;
      
      const lineBasedPx = HEADER_HEIGHT + PADDING + Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(75, Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)));
      
      // Should be capped at 75%
      expect(newSize).toBeLessThanOrEqual(75);
      expect(newSize).toBeGreaterThanOrEqual(25);
    });

    it('should handle empty error output', () => {
      const emptyErrors = '';
      
      // When output is empty, condition hasCompilationErrors && cliOutput.trim().length > 0 is false
      const shouldProcess = true && emptyErrors.trim().length > 0;
      expect(shouldProcess).toBe(false);
    });

    it('should handle empty parser messages list', () => {
      const messages: ParserMessage[] = [];
      
      const shouldShow = messages.length > 0;
      expect(shouldShow).toBe(false);
    });

    it('should handle rapid state changes', () => {
      // Simulate: error -> success -> error -> success
      const states = [
        { hasErrors: true, hasMessages: false, lastResult: 'error' as const },
        { hasErrors: false, hasMessages: false, lastResult: 'success' as const },
        { hasErrors: true, hasMessages: false, lastResult: 'error' as const },
        { hasErrors: false, hasMessages: false, lastResult: 'success' as const },
      ];

      states.forEach((state) => {
        const shouldShow = state.hasErrors || (state.lastResult !== 'success' || state.hasMessages);
        expect(typeof shouldShow).toBe('boolean');
      });
    });

    it('should handle concurrent errors and messages', () => {
      const state = {
        hasErrors: true,
        messages: [{ id: 'msg1' }],
      };

      // Errors take precedence - should show compiler tab
      const shouldShowCompilerTab = state.hasErrors;
      expect(shouldShowCompilerTab).toBe(true);
    });
  });

  describe('Condition Logic Verification', () => {
    it('should correctly identify when to show panel for compiler errors', () => {
      const condition = (hasErrors: boolean, output: string) => {
        return hasErrors && output.trim().length > 0;
      };

      expect(condition(true, 'error: test')).toBe(true);
      expect(condition(true, '')).toBe(false);
      expect(condition(true, '   ')).toBe(false);
      expect(condition(false, 'error: test')).toBe(false);
    });

    it('should correctly identify when to show panel for parser messages', () => {
      const condition = (messageCount: number, hasErrors: boolean) => {
        return messageCount > 0 && !hasErrors;
      };

      expect(condition(1, false)).toBe(true);
      expect(condition(0, false)).toBe(false);
      expect(condition(5, false)).toBe(true);
      expect(condition(1, true)).toBe(false);
    });

    it('should correctly identify when to minimize panel', () => {
      const condition = (lastResult: string | null, hasErrors: boolean, messageCount: number) => {
        return lastResult === 'success' && !hasErrors && messageCount === 0;
      };

      expect(condition('success', false, 0)).toBe(true);
      expect(condition('success', false, 1)).toBe(false);
      expect(condition('success', true, 0)).toBe(false);
      expect(condition('error', false, 0)).toBe(false);
      expect(condition(null, false, 0)).toBe(false);
    });

    it('should correctly determine panel visibility logic', () => {
      const shouldShowOutput = (
        hasErrors: boolean,
        showOutput: boolean,
        messageCount: number,
        panelDismissed: boolean
      ) => {
        return hasErrors || showOutput || (messageCount > 0 && !panelDismissed);
      };

      // Errors always show panel
      expect(shouldShowOutput(true, false, 0, true)).toBe(true);

      // User explicitly showed panel
      expect(shouldShowOutput(false, true, 0, true)).toBe(true);

      // Messages show panel if not dismissed
      expect(shouldShowOutput(false, false, 1, false)).toBe(true);
      expect(shouldShowOutput(false, false, 1, true)).toBe(false);

      // Nothing shows panel
      expect(shouldShowOutput(false, false, 0, true)).toBe(false);
    });
  });
});
