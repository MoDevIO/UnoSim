import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArduinoCompiler } from "../../../server/services/arduino-compiler";
import * as cliRunner from "../../../server/services/compiler/cli-runner";
import { buildSketchHash } from "../../../server/services/workers/compile-worker-utils";

describe("ArduinoCompiler cache key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compiles again when only a header changed", async () => {
    const cli = vi.spyOn(cliRunner, "compileWithArduinoCli").mockResolvedValue({
      success: true,
      output: "Sketch uses 1 bytes.\n\nBoard: Arduino UNO",
      binary: Buffer.from(":00000001FF\n"),
    });
    const compiler = await ArduinoCompiler.create();
    // Unique code keeps this test independent of earlier on-disk cache entries.
    const code = `#include "pins.h"\n// ${randomUUID()}\nvoid setup(){}\nvoid loop(){}\n`;

    await compiler.compile(code, [{ name: "pins.h", content: "#define PIN 5" }]);
    await compiler.compile(code, [{ name: "pins.h", content: "#define PIN 6" }]);

    expect(cli).toHaveBeenCalledTimes(2);
  });

  it("uses the same sketch identity as the compile worker", async () => {
    const cli = vi.spyOn(cliRunner, "compileWithArduinoCli").mockResolvedValue({
      success: true,
      output: "Board: Arduino UNO",
      binary: Buffer.from(":00000001FF\n"),
    });
    const compiler = await ArduinoCompiler.create();
    const code = `// ${randomUUID()}\nvoid setup(){}\nvoid loop(){}\n`;
    const headers = [{ name: "pins.h", content: "#define PIN 5" }];

    await compiler.compile(code, headers, undefined, { sketchHash: buildSketchHash({ code, headers }, "arduino:avr:uno") });
    await compiler.compile(code, headers);

    expect(cli).toHaveBeenCalledOnce();
  });
});
