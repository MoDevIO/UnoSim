import { ArduinoCompiler } from '../../../server/services/arduino-compiler';
import { spawn } from 'child_process';
import type { ParserMessage } from '../../../shared/schema';

jest.mock('child_process');

describe('Parser Messages Integration', () => {
  let compiler: ArduinoCompiler;

  beforeEach(() => {
    compiler = new ArduinoCompiler();
    jest.clearAllMocks();
  });

  it('should include Serial.begin missing warning ONLY in parserMessages, not in output', async () => {
    const code = `
      void setup() {
        pinMode(13, OUTPUT);
      }
      void loop() {
        Serial.println("Hello");
        digitalWrite(13, HIGH);
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should be in parserMessages
    expect(result.parserMessages).toBeDefined();
    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBeGreaterThan(0);
    expect(serialMessages.some(m => m.message.includes('Serial.begin'))).toBe(true);

    // Should NOT be in output as warning text
    expect(result.output).not.toContain('⚠️ Serial.begin');
    expect(result.output).not.toContain('Serial output may not work correctly');
  });

  it('should warn when Serial is used without Serial.begin and setup is empty', async () => {
    const code = `
      void setup()
      {
        
      }

      void loop()
      {
        Serial.println("Hello World!");
        delay(1000);
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBeGreaterThan(0);
    expect(serialMessages.some(m => m.message.includes('Serial.begin'))).toBe(true);

    expect(result.output).not.toContain('⚠️ Serial.begin');
  });

  it('should NOT warn about Serial.begin when Serial is not used', async () => {
    const code = `
      void setup() {
        pinMode(13, OUTPUT);
      }
      void loop() {
        digitalWrite(13, HIGH);
        delay(1000);
        digitalWrite(13, LOW);
        delay(1000);
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should have NO Serial messages
    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBe(0);

    // Should NOT be in output
    expect(result.output).not.toContain('Serial.begin');
  });

  it('should include wrong baudrate warning ONLY in parserMessages', async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }
      void loop() {
        Serial.println("Test");
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should be in parserMessages
    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBeGreaterThan(0);
    expect(serialMessages.some(m => m.message.includes('9600'))).toBe(true);

    // Should NOT be in output
    expect(result.output).not.toContain('⚠️ Serial.begin(9600)');
    expect(result.output).not.toContain('wrong baud rate');
  });

  it('should NOT include Serial warnings when Serial.begin(115200) is correct', async () => {
    const code = `
      void setup() {
        Serial.begin(115200);
      }
      void loop() {
        Serial.println("OK");
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should have NO Serial warnings
    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBe(0);

    // Should NOT be in output
    expect(result.output).not.toContain('Serial.begin');
  });

  it('should include commented-out Serial.begin warning in parserMessages', async () => {
    const code = `
      void setup() {
        // Serial.begin(115200);
        pinMode(13, OUTPUT);
      }
      void loop() {
        Serial.println("Test");
      }
    `;

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success\n'));
        },
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should be in parserMessages
    const messages = result.parserMessages as ParserMessage[];
    const serialMessages = messages.filter(m => m.category === 'serial');
    expect(serialMessages.length).toBeGreaterThan(0);
    expect(serialMessages.some(m => m.message.includes('commented'))).toBe(true);

    // Should NOT be in output
    expect(result.output).not.toContain('⚠️ Serial.begin()');
    expect(result.output).not.toContain('commented out');
  });
});
