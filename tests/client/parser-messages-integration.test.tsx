/**
 * Tests für Parser Messages Integration im Frontend
 * 
 * Diese Tests verifizieren, dass:
 * 1. Parser Messages vom Compile-Response im Frontend gesetzt werden
 * 2. Das ParserOutput-Panel bei Messages angezeigt wird
 * 3. Serial-Warnungen korrekt angezeigt werden
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ParserOutput } from '../../client/src/components/features/parser-output';
import type { ParserMessage, IOPinRecord } from '@shared/schema';

describe('Parser Messages Frontend Integration', () => {
  
  describe('ParserOutput Component', () => {
    
    it('sollte Messages-Tab anzeigen wenn parserMessages vorhanden', () => {
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
      
      // Header sollte "Parser Analysis" zeigen
      expect(screen.getByText('Parser Analysis')).toBeInTheDocument();
      
      // Messages-Tab sollte angezeigt werden
      expect(screen.getByText('Messages (1)')).toBeInTheDocument();
    });

    it('sollte Serial-Warnungen mit korrektem Icon anzeigen', () => {
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
      
      // Die Warnung sollte angezeigt werden
      expect(screen.getByText(/wrong baud rate/)).toBeInTheDocument();
      expect(screen.getByText('Serial Configuration')).toBeInTheDocument();
    });

    it('sollte Serial.begin Suggestion anzeigen', () => {
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
      
      // Suggestion sollte angezeigt werden (Text erscheint mehrfach - Message + Suggestion)
      const serialBeginElements = screen.getAllByText(/Serial.begin\(115200\)/);
      expect(serialBeginElements.length).toBeGreaterThanOrEqual(1);
    });

    it('sollte I/O Registry Tab bei Inkonsistenzen anzeigen', () => {
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
      
      // Registry-Tab sollte angezeigt werden (weil digitalWrite ohne pinMode)
      expect(screen.getByText(/I\/O Registry/)).toBeInTheDocument();
    });

    it('sollte beide Tabs anzeigen wenn Messages und Registry-Probleme existieren', () => {
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
      
      // Beide Tabs sollten angezeigt werden
      expect(screen.getByText('Messages (1)')).toBeInTheDocument();
      expect(screen.getByText(/I\/O Registry/)).toBeInTheDocument();
    });

    it('sollte Fehler-Zähler im Header anzeigen', () => {
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
      
      // Sollte Fehler und Warnungen anzeigen (severity 3 = error, severity 2 = warning)
      // Header sollte beide Zähler anzeigen (text-red-400 für errors, text-yellow-400 für warnings)
      const errorCount = document.querySelector('.text-red-400');
      const warningCount = document.querySelector('.text-yellow-400');
      expect(errorCount).toBeInTheDocument();
      expect(warningCount).toBeInTheDocument();
    });

    it('sollte Clear-Button haben', () => {
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
      
      // Clear-Button sollte vorhanden sein
      const clearButton = screen.getByTitle('Clear');
      expect(clearButton).toBeInTheDocument();
      
      // Klick auf Clear sollte onClear aufrufen
      fireEvent.click(clearButton);
      expect(onClear).toHaveBeenCalled();
    });
  });
  
  describe('Message Categories', () => {
    it('sollte alle Message-Kategorien korrekt labeln', () => {
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
