import { describe, expect, it } from "vitest";
import {
  appendCompilerDiagnostics,
  limitCompilerDiagnostics,
  MAX_COMPILER_DIAGNOSTIC_CHARS,
  type CompilerDiagnosticsBuffer,
} from "../../../server/services/compiler-diagnostics";

describe("compiler diagnostics limits", () => {
  it("leaves diagnostics within the limit unchanged", () => {
    expect(limitCompilerDiagnostics("sketch.ino:1:1: error: x\n")).toBe("sketch.ino:1:1: error: x\n");
  });

  it("cuts oversized diagnostics at a line boundary and names the omitted amount", () => {
    const line = "sketch.ino:1:1: error: expected ';'\n";
    const text = line.repeat(Math.ceil((MAX_COMPILER_DIAGNOSTIC_CHARS * 2) / line.length));
    const limited = limitCompilerDiagnostics(text);
    const [shown, notice] = [limited.slice(0, limited.lastIndexOf("\n")), limited.slice(limited.lastIndexOf("\n") + 1)];

    expect(shown.length).toBeLessThanOrEqual(MAX_COMPILER_DIAGNOSTIC_CHARS);
    expect(shown.endsWith("expected ';'")).toBe(true);
    expect(notice).toBe(`... ${text.length - shown.length} more characters of compiler output omitted.`);
  });

  it("keeps only the shown prefix while output streams in and counts the rest", () => {
    const buffer: CompilerDiagnosticsBuffer = { value: "" };
    const chunk = "x".repeat(100_000);
    for (let index = 0; index < 10; index += 1) appendCompilerDiagnostics(buffer, chunk);

    expect(buffer.value.length).toBe(MAX_COMPILER_DIAGNOSTIC_CHARS);
    expect(buffer.omittedChars).toBe(1_000_000 - MAX_COMPILER_DIAGNOSTIC_CHARS);
    expect(limitCompilerDiagnostics(buffer.value, buffer.omittedChars)).toMatch(/\.\.\. 737856 more characters/);
  });
});
