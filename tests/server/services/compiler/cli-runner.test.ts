import { describe, expect, it, vi } from "vitest";
import { compileWithArduinoCli } from "../../../../server/services/compiler/cli-runner";
import { ProcessOutputLimitError, type ProcessExecutor } from "../../../../server/services/process-executor";

describe("compileWithArduinoCli", () => {
  it("classifies an Arduino memory overflow after a started CLI as a compile error", async () => {
    const processExecutor = {
      execute: vi.fn().mockResolvedValue({
        code: 1,
        stdout: [
          "Sketch uses 15202 bytes (47%) of program storage space. Maximum is 32256 bytes.",
          "Global variables use 3563 bytes (173%) of dynamic memory, leaving -1515 bytes for local variables. Maximum is 2048 bytes.",
        ].join("\n"),
        stderr: [
          "Not enough memory",
          "data section exceeds available space in board",
          "Compilation error: data section exceeds available space in board",
        ].join("\n"),
        error: new Error("arduino-cli exit code 1"),
      }),
    } as unknown as ProcessExecutor;

    const result = await compileWithArduinoCli(
      "/tmp/unosim/sketch.ino",
      { fqbn: "arduino:avr:uno" },
      processExecutor,
    );

    expect(result.success).toBe(false);
    expect(result.errors).not.toContain("Make sure arduino-cli is installed and in PATH");
    expect(result.output).toContain("Sketch uses 15202 bytes");
    expect(result.output).toContain("Global variables use 3563 bytes");
    expect(result.parsedErrors).toEqual([
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Not enough memory"),
      }),
    ]);
    expect(result.parsedErrors?.[0]?.message).toContain("data section exceeds available space");
  });

  it("caps compiler output and reports a diagnostic flood as a truncated compile error", async () => {
    const flood = "/tmp/unosim/sketch.ino:3:1: error: expected ';' before '}' token\n".repeat(20_000);
    const processExecutor = {
      execute: vi.fn().mockResolvedValue({
        code: -1,
        stdout: "",
        stderr: flood,
        error: new ProcessOutputLimitError(8 * 1024 * 1024),
      }),
    } as unknown as ProcessExecutor;

    const result = await compileWithArduinoCli("/tmp/unosim/sketch.ino", { fqbn: "arduino:avr:uno" }, processExecutor);

    expect(processExecutor.execute).toHaveBeenCalledWith("arduino-cli", expect.any(Array), expect.objectContaining({
      maxOutputBytes: 8 * 1024 * 1024,
    }));
    expect(result.success).toBe(false);
    expect(result.errors).not.toContain("Failed to execute arduino-cli");
    expect(result.errors!.length).toBeLessThan(260 * 1024);
    expect(result.errors).toMatch(/more characters of compiler output omitted\.$/);
    expect(result.parsedErrors!.length).toBeGreaterThan(0);
    expect(result.parsedErrors!.length).toBeLessThan(5_000);
  });

  it("keeps library scan diagnostics as warnings", async () => {
    const processExecutor = {
      execute: vi.fn().mockResolvedValue({
        code: 1,
        stdout: "WARNING: library Foo claims to run on all architecture(s) and may be incompatible.",
        stderr: "",
        error: new Error("arduino-cli exit code 1"),
      }),
    } as unknown as ProcessExecutor;

    const result = await compileWithArduinoCli(
      "/tmp/unosim/sketch.ino",
      { fqbn: "arduino:avr:uno" },
      processExecutor,
    );

    expect(result.parsedErrors).toEqual([
      expect.objectContaining({ type: "warning", message: expect.stringContaining("library Foo") }),
    ]);
  });

  it("adds the PATH hint only when the CLI cannot be spawned", async () => {
    const processExecutor = {
      execute: vi.fn().mockResolvedValue({
        code: -1,
        stdout: "",
        stderr: "",
        error: new Error("spawn arduino-cli ENOENT"),
      }),
    } as unknown as ProcessExecutor;

    const result = await compileWithArduinoCli(
      "/tmp/unosim/sketch.ino",
      { fqbn: "arduino:avr:uno" },
      processExecutor,
    );

    expect(result.errors).toContain("Make sure arduino-cli is installed and in PATH");
    expect(result.parsedErrors?.[0]?.file).toBe("system");
  });
});

describe("compiler output board name (plan P2.2)", () => {
  const success = (stdout = "Sketch uses 100 bytes (1%) of program storage space.\nGlobal variables use 9 bytes (0%) of dynamic memory.") => ({
    execute: vi.fn().mockResolvedValue({ code: 0, stdout, stderr: "" }),
  }) as unknown as ProcessExecutor;

  it.each([
    ["arduino:avr:uno", "Board: Arduino UNO"],
    ["arduino:avr:nano:cpu=atmega328", "Board: Arduino Nano"],
    ["arduino:avr:mega:cpu=atmega2560", "Board: Arduino Mega 2560"],
    ["ATTinyCore:avr:attinyx5:chip=85,clock=8internal", "Board: ATtiny85"],
  ])("names the catalog board of %s", async (fqbn, line) => {
    const result = await compileWithArduinoCli("/tmp/unosim/sketch.ino", { fqbn }, success());

    expect(result.output.endsWith(line)).toBe(true);
  });

  it("falls back to the FQBN for a board outside the catalog", async () => {
    const result = await compileWithArduinoCli("/tmp/unosim/sketch.ino", { fqbn: "vendor:arch:board" }, success());

    expect(result.output.endsWith("Board: vendor:arch:board")).toBe(true);
  });
});

describe("build outputs next to the HEX (plan P2.5)", () => {
  it("returns the ELF of the build, passes the fixed build flags and ignores bootloader images", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { FIXED_BUILD_FLAGS } = await import("../../../../server/services/compiler/cli-runner");
    const buildPath = await mkdtemp(join(tmpdir(), "unosim-cli-elf-"));
    try {
      await writeFile(join(buildPath, "sketch.ino.hex"), ":00000001FF\n");
      await writeFile(join(buildPath, "sketch.ino.with_bootloader.hex"), "bootloader");
      await writeFile(join(buildPath, "sketch.ino.elf"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      const execute = vi.fn().mockResolvedValue({ code: 0, stdout: "Sketch uses 1 bytes.", stderr: "" });

      const result = await compileWithArduinoCli("/tmp/unosim/sketch.ino", { fqbn: "arduino:avr:uno", buildPath }, { execute } as unknown as ProcessExecutor);

      expect(result.elf).toEqual(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      expect(result.binary?.toString()).toBe(":00000001FF\n");
      expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining([...FIXED_BUILD_FLAGS]));
    } finally {
      await rm(buildPath, { recursive: true, force: true });
    }
  });

  it("returns no ELF when the build produced none", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 0, stdout: "Sketch uses 1 bytes.", stderr: "" });

    const result = await compileWithArduinoCli("/tmp/unosim/sketch.ino", { fqbn: "arduino:avr:uno", buildPath: "/nonexistent/path" }, { execute } as unknown as ProcessExecutor);

    expect(result.elf).toBeUndefined();
  });
});
