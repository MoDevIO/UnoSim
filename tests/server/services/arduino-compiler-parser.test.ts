import { ArduinoCompiler } from '../../../server/services/arduino-compiler';
import { ParserMessage } from '../../../shared/schema';

jest.mock('child_process');
const { spawn } = require('child_process');

describe('ArduinoCompiler - Parser Integration', () => {
  let compiler: ArduinoCompiler;

  beforeEach(async () => {
    compiler = await ArduinoCompiler.create();
  });

  it('should include parser messages in compilation result', async () => {
    const code = `
      void setup() {
        Serial.begin(9600);  // Wrong baudrate
      }
      void loop() {
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

    // Check that parserMessages are included
    expect(result.parserMessages).toBeDefined();
    expect(Array.isArray(result.parserMessages)).toBe(true);
    
    // Should detect Serial.begin wrong baudrate
    const serialWarnings = (result.parserMessages as ParserMessage[]).filter(
      m => m.category === 'serial'
    );
    expect(serialWarnings.length).toBeGreaterThan(0);
  });

  it('should return empty parser messages for correct code', async () => {
    const code = `
      void setup() {
        Serial.begin(115200);
        pinMode(5, OUTPUT);
      }
      void loop() {
        digitalWrite(5, HIGH);
        delay(100);
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

    // Should have no parser messages for correct code
    expect(result.parserMessages).toEqual([]);
  });

  it('should include parser messages even when compilation fails', async () => {
    const code = `
      void setup() {
        Serial.begin(9600);  // Wrong baudrate
      }
      // Missing loop function
    `;

    const result = await compiler.compile(code);

    // Should have parser messages about missing loop and wrong baudrate
    expect(result.parserMessages).toBeDefined();
    const messages = result.parserMessages as ParserMessage[];
    expect(messages.length).toBeGreaterThan(0);
  });

  it('should include multiple parser messages from different categories', async () => {
    const code = `
      void setup() {
        Serial.begin(9600);  // Wrong baudrate
        pinMode(2, OUTPUT);
        pinMode(A0, OUTPUT);
      }
      void loop() {
        while(true) {  // Infinite loop
          analogWrite(2, 128);  // PWM on wrong pin
          int val = analogRead(A0);  // Pin conflict
          Serial.read();  // Missing Serial.available
        }
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

    // Should have messages from multiple categories
    const categories = new Set(messages.map(m => m.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});
