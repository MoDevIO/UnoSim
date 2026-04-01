import { vi } from "vitest";
import { ArduinoCompiler } from "../../../server/services/arduino-compiler";

describe("ArduinoCompiler - additional", () => {

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns error when setup or loop missing", async () => {
    const compiler = await ArduinoCompiler.create();
    const res = await compiler.compile("int main() {}");
    expect(res.success).toBe(false);
    expect(res.stderr).toMatch(/Missing Arduino functions/);
    expect(res.errors).toHaveLength(0);
  });

  test("processes header includes and returns processedCode", async () => {
    const compileSpy = vi
      .spyOn(ArduinoCompiler.prototype as any, "compileWithArduinoCli")
      .mockResolvedValue({ success: true, output: "Board: Arduino UNO" });

    const compiler = await ArduinoCompiler.create();
    const code = `#include "myheader.h"\nvoid setup(){}\nvoid loop(){}\nSerial.println("x");`;
    const headers = [{ name: "myheader.h", content: "int foo(){return 1; }" }];

    const res = await compiler.compile(code, headers);
    expect(res.success).toBe(true);
    expect(compileSpy).toHaveBeenCalledOnce();
    // Note: processedCode was removed from CompilationResult as an optimization
    expect(res.output).toMatch(/Board: Arduino UNO/);
  });

  test("falls through to recompile when binary cache exists but output sidecar is missing", async () => {
    // Simulate old cache entry: binary present, but no .output.txt sidecar
    vi.spyOn(ArduinoCompiler.prototype as any, "checkCacheHits").mockResolvedValue({
      cached: true,
      binary: Buffer.from("fake-hex"),
      cacheType: "instant",
      cachedOutput: null, // sidecar not written yet
    });

    const fullOutput = "Sketch uses 2762 bytes (8% of program storage space).\nGlobal variables use 224 bytes (10% of dynamic memory).\n\nBoard: Arduino UNO";
    const compileSpy = vi
      .spyOn(ArduinoCompiler.prototype as any, "compileWithArduinoCli")
      .mockResolvedValue({ success: true, output: fullOutput });

    const compiler = await ArduinoCompiler.create();
    const code = "void setup(){}\nvoid loop(){}";
    const res = await compiler.compile(code);

    // Must trigger a real compile (not use the bare fallback)
    expect(compileSpy).toHaveBeenCalledOnce();
    // Output must contain sketch size info, not just the bare fallback
    expect(res.output).toContain("Sketch uses");
    expect(res.output).toContain("Board: Arduino UNO");
    expect(res.output).not.toBe("Board: Arduino UNO");
  });
});
