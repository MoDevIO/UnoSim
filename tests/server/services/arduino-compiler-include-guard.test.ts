import { afterEach, describe, expect, it, vi } from "vitest";
import { ArduinoCompiler } from "../../../server/services/arduino-compiler";
import * as cliRunner from "../../../server/services/compiler/cli-runner";
import * as cacheManager from "../../../server/services/compiler/cache-manager";

const UNSAFE = '#include "/etc/hosts"\nvoid setup(){}\nvoid loop(){}\n';

describe("ArduinoCompiler include boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an include outside the project before arduino-cli or the cache is consulted", async () => {
    const cli = vi.spyOn(cliRunner, "compileWithArduinoCli");
    const cache = vi.spyOn(cacheManager, "checkCacheHits");
    const compiler = await ArduinoCompiler.create();

    const result = await compiler.compile(UNSAFE, [], undefined, { entryFile: "sketch.ino" });

    expect(cli).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, arduinoCliStatus: "error" });
    expect(result.errors).toEqual([
      expect.objectContaining({ file: "sketch.ino", line: 1, type: "error" }),
    ]);
  });

  it("rejects an unsafe include in a submitted header without an entry file", async () => {
    const cli = vi.spyOn(cliRunner, "compileWithArduinoCli");
    const compiler = await ArduinoCompiler.create();

    const result = await compiler.compile(
      '#include "lib.h"\nvoid setup(){}\nvoid loop(){}\n',
      [{ name: "lib.h", content: "#include </etc/hosts>\n" }],
    );

    expect(cli).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({ file: "lib.h", line: 1 });
  });
});
