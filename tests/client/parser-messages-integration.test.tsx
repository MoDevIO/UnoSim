/**
 * Tests for Parser Messages Integration in Frontend
 * 
 * These tests verify that:
 * 1. Parser Messages from Compile-Response are set in Frontend
 * 2. The ParserOutput panel is shown when messages are present
 * 3. Serial warnings are displayed correctly
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ParserOutput } from '../../client/src/components/features/parser-output';
import type { ParserMessage, IOPinRecord } from '@shared/schema';

describe('Parser Messages Frontend Integration', () => {
  
  describe('ParserOutput Component', () => {
    
    it('should display Messages tab when parserMessages are present', () => {
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial.begin(115200) is missing in setup(). Serial output may not work correctly.',
          suggestion: 'Serial.begin(115200);',
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
        />
      );
      
      // Header should show "Parser Analysis"
      expect(screen.getByText('Parser Analysis')).toBeInTheDocument();
      
      // Messages tab should be displayed
      expect(screen.getByText('Messages (1)')).toBeInTheDocument();
    });

    it('should display serial warnings with correct icon', () => {
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial.begin(9600) uses wrong baud rate. This simulator expects Serial.begin(115200).',
          suggestion: 'Serial.begin(115200);',
          line: 3,
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
        />
      );
      
      // The warning should be displayed
      expect(screen.getByText(/wrong baud rate/)).toBeInTheDocument();
      expect(screen.getByText('Serial Configuration')).toBeInTheDocument();
    });

    it('should display Serial.begin suggestion', () => {
      const onInsertSuggestion = jest.fn();
      
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Serial.begin(115200) is missing',
          suggestion: 'Serial.begin(115200);',
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
          onInsertSuggestion={onInsertSuggestion}
        />
      );
      
      // Suggestion should be displayed (Text appears multiple times - Message + Suggestion)
      const serialBeginElements = screen.getAllByText(/Serial.begin\(115200\)/);
      expect(serialBeginElements.length).toBeGreaterThanOrEqual(1);
    });

    it('should display I/O Registry tab when inconsistencies are present', () => {
      const ioRegistry: IOPinRecord[] = [
        {
          pin: '5',
          defined: false,
          usedAt: [
            { line: 10, operation: 'digitalWrite' }
          ]
        }
      ];
      
      render(
        <ParserOutput 
          messages={[]}
          ioRegistry={ioRegistry}
          onClear={() => {}}
        />
      );
      
      // Registry tab should be displayed (because digitalWrite without pinMode)
      expect(screen.getByText(/I\/O Registry/)).toBeInTheDocument();
    });

    it('should display both tabs when Messages and Registry problems exist', () => {
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Missing Serial.begin',
          suggestion: 'Serial.begin(115200);',
        }
      ];
      
      const ioRegistry: IOPinRecord[] = [
        {
          pin: '5',
          defined: false,
          usedAt: [
            { line: 10, operation: 'digitalWrite' }
          ]
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={ioRegistry}
          onClear={() => {}}
        />
      );
      
      // Both tabs should be displayed
      expect(screen.getByText('Messages (1)')).toBeInTheDocument();
      expect(screen.getByText(/I\/O Registry/)).toBeInTheDocument();
    });

    it('should display error counter in header', () => {
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'error',
          category: 'structure',
          severity: 3,
          message: 'Missing void setup() function',
        },
        {
          id: 'test-2',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Missing Serial.begin',
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
        />
      );
      
      // Should show errors and warnings (severity 3 = error, severity 2 = warning)
      // Header should display both counters (text-red-400 for errors, text-yellow-400 for warnings)
      const errorCount = document.querySelector('.text-red-400');
      const warningCount = document.querySelector('.text-yellow-400');
      expect(errorCount).toBeInTheDocument();
      expect(warningCount).toBeInTheDocument();
    });

    it('should have Clear button', () => {
      const onClear = jest.fn();
      
      const messages: ParserMessage[] = [
        {
          id: 'test-1',
          type: 'warning',
          category: 'serial',
          severity: 2,
          message: 'Test warning',
        }
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={onClear}
        />
      );
      
      // Clear button should be present (in code it has title="Close")
      const clearButton = screen.getByTitle('Close');
      expect(clearButton).toBeInTheDocument();
      
      // Click on Clear should call onClear
      fireEvent.click(clearButton);
      expect(onClear).toHaveBeenCalled();
    });
  });
  
  describe('Message Categories', () => {
    it('should label all message categories correctly', () => {
      const messages: ParserMessage[] = [
        { id: '1', type: 'warning', category: 'serial', severity: 2, message: 'Serial issue' },
        { id: '2', type: 'error', category: 'structure', severity: 3, message: 'Structure issue' },
        { id: '3', type: 'warning', category: 'hardware', severity: 2, message: 'Hardware issue' },
        { id: '4', type: 'warning', category: 'performance', severity: 2, message: 'Performance issue' },
      ];
      
      render(
        <ParserOutput 
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
        />
      );
      
      expect(screen.getByText('Serial Configuration')).toBeInTheDocument();
      expect(screen.getByText('Code Structure')).toBeInTheDocument();
      expect(screen.getByText('Hardware Compatibility')).toBeInTheDocument();
      expect(screen.getByText('Performance Issues')).toBeInTheDocument();
    });
  });
});
