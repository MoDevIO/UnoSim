import { ArduinoCompiler } from "../../../server/services/arduino-compiler";
import { ParserMessage } from "../../../shared/schema";
import { spawn } from "node:child_process";

vi.setConfig({ testTimeout: 2000 });

const createMockProcess = () => {
  const mockProcess = {
    on: vi.fn((event: string, cb: Function) => {
      if (event === "close") setTimeout(() => cb(0), 10);
      return mockProcess;
    }),
    stdout: { on: vi.fn().mockReturnThis() },
    stderr: { on: vi.fn().mockReturnThis() },
    kill: vi.fn(),
  };
  return mockProcess;
};

vi.mock("node:child_process", () => {
  const spawnMock = vi.fn(() => createMockProcess());
  return {
    spawn: spawnMock,
    default: { spawn: spawnMock },
  };
});

describe("ArduinoCompiler - Parser Integration", () => {
  let compiler: ArduinoCompiler;

  beforeEach(async () => {
    compiler = await ArduinoCompiler.create();
  });

  it("should include parser messages in compilation result", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);  // Wrong baudrate
      }
      void loop() {
        Serial.println("test");
        digitalWrite(13, HIGH);
      }
    `;

    vi.mocked(spawn).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === "data") cb(Buffer.from("Success\n"));
        },
      },
      stderr: { on: vi.fn() },
      on: (event: string, cb: Function) => {
        if (event === "close") cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Check that parserMessages are included
    expect(result.parserMessages).toBeDefined();
    expect(Array.isArray(result.parserMessages)).toBe(true);

    // Should detect Serial.begin wrong baudrate
    const serialWarnings = (result.parserMessages as ParserMessage[]).filter(
      (m) => m.category === "serial",
    );
    expect(serialWarnings.length).toBeGreaterThan(0);
  });

  it("should return empty parser messages for correct code", async () => {
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

    vi.mocked(spawn).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === "data") cb(Buffer.from("Success\n"));
        },
      },
      stderr: { on: vi.fn() },
      on: (event: string, cb: Function) => {
        if (event === "close") cb(0);
      },
    }));

    const result = await compiler.compile(code);

    // Should have no parser messages for correct code
    expect(result.parserMessages).toEqual([]);
  });

  it("should include parser messages even when compilation fails", async () => {
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

  it("should include multiple parser messages from different categories", async () => {
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

    vi.mocked(spawn).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === "data") cb(Buffer.from("Success\n"));
        },
      },
      stderr: { on: vi.fn() },
      on: (event: string, cb: Function) => {
        if (event === "close") cb(0);
      },
    }));

    const result = await compiler.compile(code);
    const messages = result.parserMessages as ParserMessage[];

    // Should have messages from multiple categories
    const categories = new Set(messages.map((m) => m.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});
