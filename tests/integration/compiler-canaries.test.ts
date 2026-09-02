import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";

const VALID_SKETCH = `
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(10);
  digitalWrite(13, LOW);
  delay(10);
}
`;

const INVALID_SKETCH = `
void setup() {
  Serial.begin(9600);
}

void loop() {
  thisFunctionDoesNotExist();
}
`;

describe("Arduino compiler canaries", () => {
  let compiler: ArduinoCompiler;
  let canaryRoot: string;

  beforeAll(async () => {
    compiler = new ArduinoCompiler();
    canaryRoot = await mkdtemp(join(tmpdir(), "unosim-compiler-canary-"));
  });

  afterAll(async () => {
    await rm(canaryRoot, { recursive: true, force: true });
  });

  it("compiles one valid sketch into a non-empty binary", async () => {
    const result = await compiler.compile(VALID_SKETCH, undefined, undefined, {
      sketchHash: randomUUID(),
      buildPath: join(canaryRoot, "valid-build"),
      hexCacheDir: join(canaryRoot, "hex-cache"),
    });

    expect(result).toMatchObject({
      success: true,
      arduinoCliStatus: "success",
      errors: [],
    });
    expect(result.binary).toBeInstanceOf(Buffer);
    expect(result.binary?.byteLength).toBeGreaterThan(0);
    expect(result.output).toContain("Board: Arduino UNO");
  }, 60_000);

  it("returns compiler diagnostics for one syntactically valid-shaped bad sketch", async () => {
    const result = await compiler.compile(
      INVALID_SKETCH,
      undefined,
      undefined,
      {
        sketchHash: randomUUID(),
        buildPath: join(canaryRoot, "invalid-build"),
        hexCacheDir: join(canaryRoot, "hex-cache"),
      },
    );

    expect(result.success).toBe(false);
    expect(result.arduinoCliStatus).toBe("error");
    expect(result.binary).toBeUndefined();
    expect(result.stderr).toContain("thisFunctionDoesNotExist");
  }, 60_000);
});
