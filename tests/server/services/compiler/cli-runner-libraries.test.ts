import { describe, expect, it, vi } from "vitest";
import { buildCompileArgs, compileWithArduinoCli } from "../../../../server/services/compiler/cli-runner";
import { compileInSandbox, type CompileSandboxSettings, readSandboxProvidedLibraries, SANDBOX_LIBRARIES_ROOT } from "../../../../server/services/compiler/sandboxed-cli-runner";
import { SKETCH_FILE_MACRO_PROPERTY } from "../../../../server/services/compiler/library-build-flags";
import type { ProcessExecution } from "../../../../server/services/process-execution-port";

const SETTINGS: CompileSandboxSettings = {
  image: "unosim-compile-sandbox:test",
  memoryMB: 512,
  cpuLimit: "1",
  pidsLimit: 128,
  tmpfsMB: 256,
  timeoutMs: 60_000,
  owner: "test-host:42",
};

describe("arduino-cli arguments with project libraries (SSOT Libraries §10)", () => {
  it("stay as they were for a build without libraries", () => {
    expect(buildCompileArgs({ fqbn: "arduino:avr:uno", libraryDirs: [] }, "/s")).toEqual(buildCompileArgs({ fqbn: "arduino:avr:uno" }, "/s"));
  });

  it("add every package directory and the __FILE__ property", () => {
    expect(buildCompileArgs({ fqbn: "arduino:avr:uno", buildPath: "/b", libraryDirs: ["/libs/A-1.0.0/A", "/libs/B-2.0.0/B"] }, "/s")).toEqual([
      "compile", "--fqbn", "arduino:avr:uno", "--verbose",
      "--library", "/libs/A-1.0.0/A", "--library", "/libs/B-2.0.0/B", "--build-property", SKETCH_FILE_MACRO_PROPERTY,
      "--build-path", "/b", "/s",
    ]);
  });

  it("compile locally with the isolated sketchbook", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "sketch.ino:1:1: error: x" });

    await compileWithArduinoCli("/tmp/unosim/s/s.ino", { fqbn: "arduino:avr:uno" }, { execute } as unknown as ProcessExecution);

    const options = execute.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.ARDUINO_DIRECTORIES_USER).toMatch(/unosim-arduino-isolation/);
    expect(options.env.ARDUINO_DIRECTORIES_BUILTIN_LIBRARIES).toMatch(/unosim-arduino-isolation/);
  });

  it("pass the package directories of the image to the compile sandbox", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await compileInSandbox("/tmp/unosim-x/0f1e/0f1e.ino", { fqbn: "arduino:avr:uno", libraryDirs: ["/opt/unosim/libraries/AUnit-1.7.1/AUnit"] }, { execute } as unknown as ProcessExecution, SETTINGS);

    const args = execute.mock.calls[0][1] as string[];
    expect(args.slice(args.indexOf("unosim-compile-sandbox:test") + 1)).toEqual([
      "unosim-compile", "60", "compile", "--fqbn", "arduino:avr:uno", "--verbose",
      "--library", "/opt/unosim/libraries/AUnit-1.7.1/AUnit", "--build-property", SKETCH_FILE_MACRO_PROPERTY, "/sketch/0f1e",
    ]);
  });
});

describe("provided libraries of the compile sandbox image", () => {
  it("reads provided.json from the image and places the packages under its library root", async () => {
    const execute = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ schemaVersion: 1, packages: [{ name: "AUnit", version: "1.7.1", sha256: "a".repeat(64), dir: "AUnit-1.7.1/AUnit" }] }),
      stderr: "",
    });

    const provided = await readSandboxProvidedLibraries({ execute } as unknown as ProcessExecution, SETTINGS);

    const args = execute.mock.calls[0][1] as string[];
    expect(args.slice(args.indexOf("unosim-compile-sandbox:test") + 1)).toEqual(["cat", `${SANDBOX_LIBRARIES_ROOT}/provided.json`]);
    expect(provided).toEqual([{ name: "AUnit", version: "1.7.1", sha256: "a".repeat(64), dir: `${SANDBOX_LIBRARIES_ROOT}/AUnit-1.7.1/AUnit` }]);
  });

  it("provides nothing when the image has no file", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "cat: no such file" });

    expect(await readSandboxProvidedLibraries({ execute } as unknown as ProcessExecution, SETTINGS)).toEqual([]);
  });
});
