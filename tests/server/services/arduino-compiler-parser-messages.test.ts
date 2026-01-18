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

  describe('Parser Messages appear ONLY in parserMessages field', () => {
    it('Serial warnings do NOT appear in output field', async () => {
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
      
      // Parser messages must exist
      expect(result.parserMessages).toBeDefined();
      expect(Array.isArray(result.parserMessages)).toBe(true);
      
      const messages = result.parserMessages!;
      const serialMessages = messages.filter(m => m.category === 'serial');
      
      // Serial warnings must be in parserMessages field
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => m.message.includes('9600'))).toBe(true);
      
      // Output field must NOT contain Serial warnings
      expect(result.output).not.toContain('Serial.begin');
      expect(result.output).not.toContain('9600');
      expect(result.output).not.toContain('115200');
      expect(result.output).not.toContain('baudrate');
      expect(result.output).not.toContain('Baudrate');
      
      // Output contains only compiler information
      expect(result.output).toContain('Sketch uses');
      expect(result.output).toContain('Board: Arduino UNO');
    });

    it('Missing Serial.begin() warning does NOT appear in output field', async () => {
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
      
      // Parser messages must exist
      const messages = result.parserMessages!;
      const serialMessages = messages.filter(m => m.category === 'serial');
      
      // Serial warnings must be in parserMessages field
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => 
        m.message.includes('Serial.begin') || m.message.includes('commented out')
      )).toBe(true);
      
      // Output field must NOT contain Serial warnings
      expect(result.output).not.toContain('Serial.begin');
      expect(result.output).not.toContain('commented');
      expect(result.output).not.toContain('missing');
    });

    it('Code without Serial usage has empty parserMessages', async () => {
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
      
      // No serial warnings when Serial is not used
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBe(0);
      
      // Output is clean (only compiler info)
      expect(result.output).toContain('Board: Arduino UNO');
      expect(result.output).not.toContain('Serial');
    });

    it('Multiple Serial issues all appear in parserMessages', async () => {
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
      
      // At least one warning due to missing Serial.begin
      expect(serialMessages.length).toBeGreaterThan(0);
      
      // All warnings are structured
      serialMessages.forEach(msg => {
        expect(msg).toHaveProperty('message');
        expect(msg).toHaveProperty('category');
        expect(msg.category).toBe('serial');
      });
      
      // Output field stays clean
      expect(result.output).not.toContain('Serial');
      expect(result.output).toContain('Board: Arduino UNO');
    });

    it('Correct code (Serial.begin(115200)) has no Serial warnings', async () => {
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
      
      // No serial warnings with correct usage
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBe(0);
      
      // Output is clean
      expect(result.output).toContain('Board: Arduino UNO');
      expect(result.output).not.toContain('warning');
      expect(result.output).not.toContain('Serial.begin');
    });
  });

  describe('Parser Messages even on Compiler Errors', () => {
    it('parserMessages are returned even on Compiler Error', async () => {
      const code = `
        void setup() {
          Serial.begin(9600); // Wrong baudrate
          int x = "wrong"; // Syntax error
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
      
      // Parser messages are present despite compiler error
      expect(result.parserMessages).toBeDefined();
      const serialMessages = result.parserMessages!.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBeGreaterThan(0);
      
      // Serial warnings not in errors field
      expect(result.errors).not.toContain('Serial.begin');
      expect(result.errors).not.toContain('9600');
    });

    it('parserMessages on missing setup()/loop()', async () => {
      const code = `
        // No setup/loop functions
        void myFunction() {
          Serial.println("Test");
        }
      `;

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('setup()');
      expect(result.errors).toContain('loop()');
      
      // Parser messages exist even with structural error
      expect(result.parserMessages).toBeDefined();
      
      // Serial warnings not in error message
      expect(result.errors).not.toContain('Serial.begin');
    });
  });
});
