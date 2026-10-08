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
