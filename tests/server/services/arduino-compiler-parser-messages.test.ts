import { ArduinoCompiler } from '../../../server/services/arduino-compiler';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';

jest.mock('child_process');
jest.mock('fs/promises');

describe('ArduinoCompiler - Parser Messages Tests', () => {
  let compiler: ArduinoCompiler;
  const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
  const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
  const mockRm = rm as jest.MockedFunction<typeof rm>;

  beforeEach(() => {
    jest.clearAllMocks();
    compiler = new ArduinoCompiler();

    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe('Parser Messages erscheinen NUR im parserMessages-Feld', () => {
    it('Serial-Warnungen erscheinen NICHT im output-Feld', async () => {
      const code = `
        void setup() {
          Serial.begin(9600); // Falsche Baudrate
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Sketch uses 1024 bytes.\nGlobal variables use 32 bytes.\n'));
          }
        },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(true);
      
      // Parser-Messages müssen existieren
      expect(result.parserMessages).toBeDefined();
      expect(Array.isArray(result.parserMessages)).toBe(true);
      
      const messages = result.parserMessages!;
      const serialMessages = messages.filter(m => m.category === 'serial');
      
      // Serial-Warnungen müssen im parserMessages-Feld sein
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => m.message.includes('9600'))).toBe(true);
      
      // Output-Feld darf KEINE Serial-Warnungen enthalten
      expect(result.output).not.toContain('Serial.begin');
      expect(result.output).not.toContain('9600');
      expect(result.output).not.toContain('115200');
      expect(result.output).not.toContain('baudrate');
      expect(result.output).not.toContain('Baudrate');
      
      // Output enthält nur Compiler-Informationen
      expect(result.output).toContain('Sketch uses');
      expect(result.output).toContain('Board: Arduino UNO');
    });

    it('Fehlende Serial.begin()-Warnung erscheint NICHT im output-Feld', async () => {
      const code = `
        void setup() {
          // Serial.begin(115200); // auskommentiert
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Sketch uses 1024 bytes.\n'));
          }
        },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(true);
      
      // Parser-Messages müssen existieren
      const messages = result.parserMessages!;
      const serialMessages = messages.filter(m => m.category === 'serial');
      
      // Serial-Warnungen müssen im parserMessages-Feld sein
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => 
        m.message.includes('Serial.begin') || m.message.includes('commented out')
      )).toBe(true);
      
      // Output-Feld darf KEINE Serial-Warnungen enthalten
      expect(result.output).not.toContain('Serial.begin');
      expect(result.output).not.toContain('commented');
      expect(result.output).not.toContain('missing');
    });

    it('Code ohne Serial-Nutzung hat leere parserMessages', async () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          delay(1000);
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Board: Arduino UNO (Simulation)\n'));
          }
        },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(true);
      expect(result.parserMessages).toBeDefined();
      
      // Keine Serial-Warnungen, wenn Serial nicht verwendet wird
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBe(0);
      
      // Output ist sauber (nur Compiler-Info)
      expect(result.output).toContain('Board: Arduino UNO');
      expect(result.output).not.toContain('Serial');
    });

    it('Mehrere Serial-Probleme erscheinen alle in parserMessages', async () => {
      const code = `
        void setup() {
          // Serial.begin(115200); // auskommentiert
        }
        void loop() {
          Serial.println("Test");
          Serial.print("Data");
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Board: Arduino UNO (Simulation)\n'));
          }
        },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(true);
      
      const messages = result.parserMessages!;
      const serialMessages = messages.filter(m => m.category === 'serial');
      
      // Mindestens eine Warnung wegen fehlendem Serial.begin
      expect(serialMessages.length).toBeGreaterThan(0);
      
      // Alle Warnungen sind strukturiert
      serialMessages.forEach(msg => {
        expect(msg).toHaveProperty('message');
        expect(msg).toHaveProperty('category');
        expect(msg.category).toBe('serial');
      });
      
      // Output-Feld bleibt sauber
      expect(result.output).not.toContain('Serial');
      expect(result.output).toContain('Board: Arduino UNO');
    });

    it('Korrekter Code (Serial.begin(115200)) hat keine Serial-Warnungen', async () => {
      const code = `
        void setup() {
          Serial.begin(115200);
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Board: Arduino UNO (Simulation)\n'));
          }
        },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(true);
      expect(result.parserMessages).toBeDefined();
      
      // Keine Serial-Warnungen bei korrekter Verwendung
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBe(0);
      
      // Output ist sauber
      expect(result.output).toContain('Board: Arduino UNO');
      expect(result.output).not.toContain('warning');
      expect(result.output).not.toContain('Serial.begin');
    });
  });

  describe('Parser Messages auch bei Compiler-Fehlern', () => {
    it('parserMessages werden auch bei Compiler-Fehler zurückgegeben', async () => {
      const code = `
        void setup() {
          Serial.begin(9600); // Falsche Baudrate
          int x = "wrong"; // Syntax-Fehler
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: { on: jest.fn() },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('error: invalid conversion'));
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1); // Fehler
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      
      // Parser-Messages sind trotz Compiler-Fehler vorhanden
      expect(result.parserMessages).toBeDefined();
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBeGreaterThan(0);
      
      // Serial-Warnungen nicht im errors-Feld
      expect(result.errors).not.toContain('Serial.begin');
      expect(result.errors).not.toContain('9600');
    });

    it('parserMessages bei fehlenden setup()/loop()', async () => {
      const code = `
        // Keine setup/loop Funktionen
        void myFunction() {
          Serial.println("Test");
        }
      `;

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('setup()');
      expect(result.errors).toContain('loop()');
      
      // Parser-Messages existieren auch bei strukturellem Fehler
      expect(result.parserMessages).toBeDefined();
      
      // Serial-Warnungen nicht in der Fehlermeldung
      expect(result.errors).not.toContain('Serial.begin');
    });
  });
});
