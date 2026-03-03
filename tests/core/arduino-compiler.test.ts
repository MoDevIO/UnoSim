import { ArduinoCompiler } from "../../server/services/arduino-compiler";

describe("ArduinoCompiler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds for a valid sketch and embeds headers", async () => {
    vi
      .spyOn(ArduinoCompiler.prototype, "compileWithArduinoCli")
      .mockResolvedValue({
        success: true,
        output:
          "Sketch uses 123 bytes.\nGlobal variables use 10 bytes.\n\nBoard: Arduino UNO",
      } as any);

    const compiler = await ArduinoCompiler.create();

    const code = `#include "myh.h"\nvoid setup() { Serial.begin(115200); }\nvoid loop() {}`;
    const headers = [
      { name: "myh.h", content: "// header content\n#define FOO 1" },
    ];

    const result = await compiler.compile(code, headers);

    expect(result.success).toBe(true);
    expect(result.arduinoCliStatus).toBe("success");
    expect(result.output).toContain("Board: Arduino UNO");
    // Note: processedCode was removed from CompilationResult as an optimization
  });

  it("returns error when arduino-cli reports compilation failures", async () => {
    // simulate compileWithArduinoCli returning errors (already cleaned)
    vi
      .spyOn(ArduinoCompiler.prototype, "compileWithArduinoCli")
      .mockResolvedValue({
        success: false,
        errors: "sketch.ino:10: error: expected ';' before '}\n",
      } as any);

    const compiler = await ArduinoCompiler.create();
    const code = "void setup() {}\nvoid loop() {}";

    const result = await compiler.compile(code);

    expect(result.success).toBe(false);
    expect(result.arduinoCliStatus).toBe("error");
    // old string field is now `stderr`
    expect(result.stderr).toBeTruthy();
    expect(result.stderr).toContain("sketch.ino");
    // parsed errors array should contain an object
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("sketch.ino");
    expect(result.errors[0].message).toContain("expected ';'");
  });

  it("rejects invalid sketch missing setup or loop", async () => {
    const compileSpy = vi.spyOn(
      ArduinoCompiler.prototype,
      "compileWithArduinoCli",
    );

    const compiler = await ArduinoCompiler.create();
    const code = "void setup() {} // missing loop";

    const result = await compiler.compile(code);

    // should never call compileWithArduinoCli because validation fails early
    expect(compileSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("Missing Arduino functions");
    expect(result.arduinoCliStatus).toBe("error");
  });

  it("handles arduino-cli not available (spawn error)", async () => {
    vi
      .spyOn(ArduinoCompiler.prototype, "compileWithArduinoCli")
      .mockResolvedValue({
        success: false,
        output: "",
        errors: "Failed to execute arduino-cli: spawn arduino-cli ENOENT. Make sure arduino-cli is installed and in PATH.",
        parsedErrors: [{
          file: "system",
          line: 0,
          column: 0,
          type: "error",
          message: "Failed to execute arduino-cli: spawn arduino-cli ENOENT. Make sure arduino-cli is installed and in PATH.",
        }],
      } as any);

    const compiler = await ArduinoCompiler.create();
    const code = "void setup() {}\nvoid loop() {}";

    const result = await compiler.compile(code);

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("Failed to execute arduino-cli");
    expect(result.arduinoCliStatus).toBe("error");
  });
});
