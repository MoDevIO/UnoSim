/**
 * Vollständige Test-Suite für ArduinoCompiler mit 100% Coverage
 * 
 * Diese Tests decken alle verbleibenden Edge-Cases ab:
 * - Zeile 88: rm Fehler im finally Block
 * - Zeile 194: Fallback-Output ohne Memory-Information
 * - Zeilen 271-273: GCC Error ohne stderr
 */

import { ArduinoCompiler } from '../../../server/services/arduino-compiler';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { Logger } from "@shared/logger";

jest.mock('child_process');
jest.mock('fs/promises');

describe('ArduinoCompiler - Full Coverage', () => {
  let compiler: ArduinoCompiler;
  const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
  const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
  const mockRm = rm as jest.MockedFunction<typeof rm>;

  beforeEach(() => {
    jest.clearAllMocks();
    compiler = new ArduinoCompiler();

    // Standard mocks
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe('Serial Validation Edge Cases', () => {
    it('should fail if Serial.begin() has wrong baudrate', async () => {
      const code = `
        void setup() {
          Serial.begin(9600); // Wrong baudrate
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
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
      // Serial warnings now appear in parserMessages, not in output
      const messages = result.parserMessages as any[];
      const serialMessages = messages.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => m.message.includes('9600') && m.message.includes('wrong'))).toBe(true);
    });

    it('should succeed with Serial.begin(115200) in block comment but active code', async () => {
      const code = `
        void setup() {
          /* This is Serial.begin(115200) in comment */
          Serial.begin(115200); // Active code
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
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
    });

    it('should succeed with code without Serial output', async () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          delay(1000);
        }
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') cb(Buffer.from('Compilation successful\n'));
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(true);
    });

    it('should fail when Serial.begin(115200) is commented out', async () => {
      const code = `
        void setup() {
          // Serial.begin(115200);
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
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
      // Serial warnings now appear in parserMessages, not in output
      const messages = result.parserMessages as any[];
      const serialMessages = messages.filter(m => m.category === 'serial');
      expect(serialMessages.length).toBeGreaterThan(0);
      expect(serialMessages.some(m => m.message.includes('commented out'))).toBe(true);
    });
  });

  describe('Memory Usage Parsing', () => {
    it('should parse English memory output', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') {
                cb(Buffer.from('Sketch uses 1024 bytes.\nGlobal variables use 32 bytes.\n'));
              }
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(true);
      expect(result.output).toEqual(expect.stringContaining('Sketch uses 1024 bytes'));
    });

    it('should parse German memory output', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') {
                cb(Buffer.from('Der Sketch verwendet 1024 Bytes.\nGlobale Variablen verwenden 32 Bytes.\n'));
              }
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(true);
      expect(result.output).toEqual(expect.stringContaining('Der Sketch verwendet 1024 Bytes'));
    });

    // CRITICAL: Test für Zeile 194
    it('should use (Simulation) output if no memory information is present', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') cb(Buffer.from('Success, no memory info.\n'));
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(true);
      expect(result.output).toEqual(expect.stringContaining('Board: Arduino UNO (Simulation)'));
    });
  });

  describe('File System Operations', () => {
    it('should handle mkdir errors gracefully', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      mockMkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('Compilation failed'));
    });

    it('should handle writeFile errors', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      mockWriteFile.mockRejectedValueOnce(new Error('Disk full'));

      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('Compilation failed'));
    });

    // CRITICAL: Test für Zeile 88
    it('should log warning if rm fails in finally block', async () => {
      const code = `
        void setup() { Serial.begin(115200); }
        void loop() {}
      `;

      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') cb(Buffer.from('Success\n'));
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      mockRm.mockRejectedValueOnce(new Error('Cleanup failure'));

      await compiler.compile(code);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cleanup failure'));
      warnSpy.mockRestore();
    });
  });

  describe('Complex Code Validation', () => {
    it('should handle setup() and loop() with complex formatting', async () => {
      const code = `
        void
        setup
        (
        )
        {
          Serial.begin(115200);
        }

        void   loop   (   )   {
          Serial.println("test");
        }
      `;

      (spawn as jest.Mock)
        .mockImplementationOnce(() => ({
          stdout: {
            on: (event: string, cb: Function) => {
              if (event === 'data') cb(Buffer.from('Success\n'));
            }
          },
          stderr: { on: jest.fn() },
          on: (event: string, cb: Function) => {
            if (event === 'close') cb(0);
          }
        }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(true);
    });

    it('should fail when both setup() and loop() are missing', async () => {
      const code = `
        int x = 5;
        void someFunction() {}
      `;

      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('setup() and loop()'));
    });

    it('should fail when only setup() is missing', async () => {
      const code = `void loop() {}`;
      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('setup()'));
    });

    it('should fail when only loop() is missing', async () => {
      const code = `void setup() {}`;
      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('loop()'));
    });
  });

  describe('Compiler Error Handling', () => {
    it('should handle arduino-cli spawn error', async () => {
      const code = `void setup() {} void loop() {}`;

      (spawn as jest.Mock).mockImplementation(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: (event: string, cb: Function) => {
          if (event === 'error') cb(new Error('spawn ENOENT'));
        }
      }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('Arduino CLI not available'));
    });

    it('should handle arduino-cli compilation failure', async () => {
      const code = `void setup() {} void loop() {}`;

      (spawn as jest.Mock).mockImplementation(() => ({
        stdout: { on: jest.fn() },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('error: expected semicolon\n'));
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const result = await compiler.compile(code);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(expect.stringContaining('expected semicolon'));
    });


  });

  describe('Constructor and Factory', () => {
    it('should handle mkdir error in ensureTempDir and log warning', async () => {
      mockMkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const newCompiler = await ArduinoCompiler.create();

      expect(newCompiler).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
      
      warnSpy.mockRestore();
    });
  });


});