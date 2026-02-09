import { ArduinoOutputParser } from '../../src/utils/arduino-output-parser';

describe('ArduinoOutputParser', () => {
  let parser: ArduinoOutputParser;
  let receivedData: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    parser = new ArduinoOutputParser();
    receivedData = [];

    parser.on('data', (chunk: string) => {
      receivedData.push(chunk);
    });
  });

  afterEach(() => {
    parser.reset();
    parser.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Datentypen-Konvertierung', () => {
    test('Integer - Standard (Dezimal)', async () => {
      parser.print(101);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['101']);
    });

    test('Integer - BIN Konvertierung', async () => {
      parser.print(5, 'BIN');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['101']);
    });

    test('Integer - OCT Konvertierung', async () => {
      parser.print(8, 'OCT');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['10']);
    });

    test('Integer - HEX Konvertierung', async () => {
      parser.print(255, 'HEX');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['FF']);
    });

    test('Integer - HEX Konvertierung (78 -> 4E)', async () => {
      parser.print(78, 'HEX');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['4E']);
    });

    test('Float - Standard (2 Nachkommastellen)', async () => {
      parser.print(3.1415);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['3.14']);
    });

    test('Float - Custom Precision (3 Nachkommastellen)', async () => {
      parser.print(1.234, 3);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['1.234']);
    });

    test('Float - Custom Precision (1.2345 mit 2 Nachkommastellen)', async () => {
      parser.print(1.2345, 2);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['1.23']);
    });

    test('Boolean - true -> "1"', async () => {
      parser.print(true);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['1']);
    });

    test('Boolean - false -> "0"', async () => {
      parser.print(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['0']);
    });

    test('String - Pass-through', async () => {
      parser.print('Hello');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['Hello']);
    });
  });

  describe('Timing: Drei-Punkte-Test', () => {
    test('Einzelnes "." wird erst nach 20ms geflusht', async () => {
      parser.print('.');
      
      // Nach 10ms sollte noch nichts gesendet worden sein
      await vi.advanceTimersByTimeAsync(10);
      expect(receivedData).toEqual([]);

      // Nach weiteren 10ms (insgesamt 20ms) sollte es geflusht werden
      await vi.advanceTimersByTimeAsync(10);
      expect(receivedData).toEqual(['.']);
    });

    test('Mehrere Zeichen ohne Newline werden nach 20ms geflusht', async () => {
      parser.print('...');
      
      await vi.advanceTimersByTimeAsync(19);
      expect(receivedData).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(receivedData).toEqual(['...']);
    });

    test('Timer wird bei neuen Zeichen zurückgesetzt', async () => {
      parser.print('.');
      await vi.advanceTimersByTimeAsync(15);
      
      // Noch kein Flush
      expect(receivedData).toEqual([]);

      // Neues Zeichen resettet den Timer
      parser.print('.');
      await vi.advanceTimersByTimeAsync(15);
      
      // Immer noch kein Flush (Timer wurde zurückgesetzt)
      expect(receivedData).toEqual([]);

      // Nach weiteren 5ms (20ms seit letztem print)
      await vi.advanceTimersByTimeAsync(5);
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

    test('print() ohne \\n wartet auf Timer, println() flusht sofort', async () => {
      parser.print('Wait');
      await vi.advanceTimersByTimeAsync(10);
      expect(receivedData).toEqual([]);
      
      parser.println('Now');
      expect(receivedData).toEqual(['WaitNow\n']);
    });
  });

  describe('Steuerzeichen', () => {
    test('Backspace (\\b) wird unverändert durchgereicht', async () => {
      parser.print('AB\b');
      await vi.advanceTimersByTimeAsync(20);
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

    test('Ohne Flush bleibt Buffer gefüllt', async () => {
      parser.print('Data');
      await vi.advanceTimersByTimeAsync(10);
      expect(parser.getBuffer()).toBe('Data');
    });
  });

  describe('Reset-Funktionalität', () => {
    test('reset() löscht Buffer', () => {
      parser.print('Data');
      parser.reset();
      expect(parser.getBuffer()).toBe('');
    });

    test('reset() stoppt laufenden Timer', async () => {
      parser.print('Data');
      parser.reset();
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual([]);
    });
  });

  describe('Integer mit numerischem Modifier', () => {
    test('Integer mit Modifier 3 fällt auf Dezimal zurück (TS-Parser)', async () => {
      // Note: In the actual pipeline, base conversion is done by the C++ mock.
      // The TS parser treats numeric modifiers on integers as decimal fallthrough.
      parser.print(255, 3);
      await vi.advanceTimersByTimeAsync(20);
      // TS parser doesn't support arbitrary bases - it falls to decimal
      expect(receivedData).toEqual(['255']);
    });

    test('println mit leerem Argument erzeugt nur Newline', () => {
      parser.println();
      expect(receivedData).toEqual(['\n']);
    });

    test('println mit String und Newline', () => {
      parser.println('Hello');
      expect(receivedData).toEqual(['Hello\n']);
    });

    test('Negative Ganzzahl', async () => {
      parser.print(-42);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['-42']);
    });

    test('Zero in verschiedenen Basen', async () => {
      parser.print(0, 'BIN');
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['0']);
    });

    test('Float mit Precision 0', async () => {
      parser.print(3.7, 0);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['4']);
    });

    test('Float Standard-Precision (1.23456 -> 1.23)', async () => {
      parser.print(1.23456);
      await vi.advanceTimersByTimeAsync(20);
      expect(receivedData).toEqual(['1.23']);
    });
  });
});