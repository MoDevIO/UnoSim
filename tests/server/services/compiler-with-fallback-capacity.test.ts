import { describe, expect, it, vi } from "vitest";

const { direct, poolCompile } = vi.hoisted(() => ({ direct: vi.fn(), poolCompile: vi.fn() }));

vi.mock("../../../server/config", () => ({ config: { serverMode: "docker", compilation: { workerCount: 2 } } }));
vi.mock("../../../server/services/arduino-compiler", () => ({
  ArduinoCompiler: vi.fn().mockImplementation(function (this: { compile: typeof direct }) {
    this.compile = direct;
  }),
}));
vi.mock("../../../server/services/compilation-worker-pool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/services/compilation-worker-pool")>();
  return { ...actual, getCompilationPool: () => ({ compile: poolCompile }) };
});

import { CompileCapacityError } from "../../../server/services/compilation-worker-pool";
import { CompilerWithFallback } from "../../../server/services/compiler-with-fallback";

describe("CompilerWithFallback at pool capacity", () => {
  it("reports the capacity error instead of compiling on the main thread", async () => {
    poolCompile.mockRejectedValueOnce(new CompileCapacityError("Compile queue full"));

    await expect(new CompilerWithFallback().compile("void setup(){} void loop(){}")).rejects.toBeInstanceOf(CompileCapacityError);
    expect(direct).not.toHaveBeenCalled();
  });

  it("still falls back when the pool itself failed", async () => {
    poolCompile.mockRejectedValueOnce(new Error("worker crashed"));
    direct.mockResolvedValueOnce({ success: true, output: "", errors: [], arduinoCliStatus: "success" });

    await expect(new CompilerWithFallback().compile("void setup(){} void loop(){}")).resolves.toMatchObject({ success: true });
    expect(direct).toHaveBeenCalledOnce();
  });
});
