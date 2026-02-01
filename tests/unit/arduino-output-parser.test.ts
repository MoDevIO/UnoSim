import { ArduinoOutputParser } from '../../src/utils/arduino-output-parser';

describe('ArduinoOutputParser', () => {
  let parser: ArduinoOutputParser;
  let receivedData: string[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    parser = new ArduinoOutputParser();
    receivedData = [];

    parser.on('data', (chunk: string) => {
      receivedData.push(chunk);
    });
  });

  afterEach(() => {
    parser.reset();
    parser.removeAllListeners();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Datentypen-Konvertierung', () => {
    test('Integer - Standard (Dezimal)', () => {
      parser.print(101);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['101']);
    });

    test('Integer - BIN Konvertierung', () => {
      parser.print(5, 'BIN');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['101']);
    });

    test('Integer - OCT Konvertierung', () => {
      parser.print(8, 'OCT');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['10']);
    });

    test('Integer - HEX Konvertierung', () => {
      parser.print(255, 'HEX');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['FF']);
    });

    test('Integer - HEX Konvertierung (78 -> 4E)', () => {
      parser.print(78, 'HEX');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['4E']);
    });

    test('Float - Standard (2 Nachkommastellen)', () => {
      parser.print(3.1415);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['3.14']);
    });

    test('Float - Custom Precision (3 Nachkommastellen)', () => {
      parser.print(1.234, 3);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['1.234']);
    });

    test('Float - Custom Precision (1.2345 mit 2 Nachkommastellen)', () => {
      parser.print(1.2345, 2);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['1.23']);
    });

    test('Boolean - true -> "1"', () => {
      parser.print(true);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['1']);
    });

    test('Boolean - false -> "0"', () => {
      parser.print(false);
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['0']);
    });

    test('String - Pass-through', () => {
      parser.print('Hello');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['Hello']);
    });
  });

  describe('Timing: Drei-Punkte-Test', () => {
    test('Einzelnes "." wird erst nach 20ms geflusht', () => {
      parser.print('.');
      
      // Nach 10ms sollte noch nichts gesendet worden sein
      jest.advanceTimersByTime(10);
      expect(receivedData).toEqual([]);

      // Nach weiteren 10ms (insgesamt 20ms) sollte es geflusht werden
      jest.advanceTimersByTime(10);
      expect(receivedData).toEqual(['.']);
    });

    test('Mehrere Zeichen ohne Newline werden nach 20ms geflusht', () => {
      parser.print('...');
      
      jest.advanceTimersByTime(19);
      expect(receivedData).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(receivedData).toEqual(['...']);
    });

    test('Timer wird bei neuen Zeichen zurückgesetzt', () => {
      parser.print('.');
      jest.advanceTimersByTime(15);
      
      // Noch kein Flush
      expect(receivedData).toEqual([]);

      // Neues Zeichen resettet den Timer
      parser.print('.');
      jest.advanceTimersByTime(15);
      
      // Immer noch kein Flush (Timer wurde zurückgesetzt)
      expect(receivedData).toEqual([]);

      // Nach weiteren 5ms (20ms seit letztem print)
      jest.advanceTimersByTime(5);
      expect(receivedData).toEqual(['..']);
    });
  });

  describe('Immediate Flush', () => {
    test('Newline (\\n) flusht sofort', () => {
      parser.print('Hello\n');
      
      // Kein Timer-Advance notwendig
      expect(receivedData).toEqual(['Hello\n']);
    });

    test('Carriage Return (\\r) flusht sofort', () => {
      parser.print('Line\r');
      
      expect(receivedData).toEqual(['Line\r']);
    });

    test('println() flusht sofort', () => {
      parser.println('Test');
      
      expect(receivedData).toEqual(['Test\n']);
    });

    test('Mehrere prints mit abschließendem \\n', () => {
      parser.print('A');
      parser.print('B');
      parser.print('\n');
      
      expect(receivedData).toEqual(['AB\n']);
    });

    test('print() ohne \\n wartet auf Timer, println() flusht sofort', () => {
      parser.print('Wait');
      jest.advanceTimersByTime(10);
      expect(receivedData).toEqual([]);
      
      parser.println('Now');
      expect(receivedData).toEqual(['WaitNow\n']);
    });
  });

  describe('Steuerzeichen', () => {
    test('Backspace (\\b) wird unverändert durchgereicht', () => {
      parser.print('AB\b');
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual(['AB\b']);
    });

    test('Tab (\\t) wird unverändert durchgereicht', () => {
      parser.print('A\tB\n');
      expect(receivedData).toEqual(['A\tB\n']);
    });

    test('ANSI Escape Sequence wird durchgereicht', () => {
      const ansi = '\x1b[31mRed Text\x1b[0m';
      parser.print(ansi + '\n');
      expect(receivedData).toEqual([ansi + '\n']);
    });

    test('Gemischte Steuerzeichen mit Daten', () => {
      parser.print('Line1\rLine2\n');
      expect(receivedData).toEqual(['Line1\rLine2\n']);
    });
  });

  describe('Buffer-Persistenz', () => {
    test('Buffer bleibt über mehrere print()-Aufrufe erhalten', () => {
      parser.print('Part1');
      parser.print('Part2');
      parser.print('Part3\n');
      
      expect(receivedData).toEqual(['Part1Part2Part3\n']);
    });

    test('Nach Flush ist Buffer leer', () => {
      parser.print('Data\n');
      expect(parser.getBuffer()).toBe('');
    });

    test('Ohne Flush bleibt Buffer gefüllt', () => {
      parser.print('Data');
      jest.advanceTimersByTime(10);
      expect(parser.getBuffer()).toBe('Data');
    });
  });

  describe('Reset-Funktionalität', () => {
    test('reset() löscht Buffer', () => {
      parser.print('Data');
      parser.reset();
      expect(parser.getBuffer()).toBe('');
    });

    test('reset() stoppt laufenden Timer', () => {
      parser.print('Data');
      parser.reset();
      jest.advanceTimersByTime(20);
      expect(receivedData).toEqual([]);
    });
  });
});