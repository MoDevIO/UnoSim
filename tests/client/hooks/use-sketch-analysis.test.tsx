import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSketchAnalysis } from "../../../client/src/hooks/use-sketch-analysis";

describe("useSketchAnalysis", () => {
  it("detects A0 and numeric 0 as pin 14", () => {
    const code = `void loop() { int a = analogRead(A0); int b = analogRead(0); }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    expect(result.current.analogPins).toEqual([14]);
  });

  it("resolves #define and variable assignments", () => {
    const code = `#define S A1\nint sensorPin = A1; void loop(){ analogRead(S); analogRead(sensorPin); }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    expect(result.current.analogPins).toEqual([15]);
    expect(result.current.varMap).toHaveProperty("S", 15);
    expect(result.current.varMap).toHaveProperty("sensorPin", 15);
  });

  it("adds pins from for-loop iteration used in analogRead", () => {
    const code = `for (byte i=16; i<20; i++) { analogRead(i); }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    expect(result.current.analogPins).toEqual([16, 17, 18, 19]);
  });

  it("detects pinMode and reports conflict when same pin used for analogRead", () => {
    const code = `pinMode(14, OUTPUT); void loop(){ analogRead(0); }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    expect(result.current.detectedPinModes[14]).toBe("OUTPUT");
    expect(result.current.pendingPinConflicts).toContain(14);
  });

  it("detects INPUT_PULLUP and numeric analog channel mapping", () => {
    const code = `pinMode(A2, INPUT_PULLUP); int v = analogRead(A2);`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    // A2 -> 16
    expect(result.current.detectedPinModes[16]).toBe("INPUT_PULLUP");
    expect(result.current.analogPins).toEqual([16]);
  });

  it("skips for-loop without opening brace", () => {
    // for-loop followed by a statement (no braces) — the for-loop path
    // should be skipped; only the direct analogRead(0) is detected
    const code = `for (int i=0; i<5; i++) analogRead(i);\nvoid loop() { analogRead(0); }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    // Pin 14 (=A0/0) is detected from the direct analogRead(0), NOT from the for-loop expansion
    // If the for-loop were expanded, we'd also see pins 15,16,17,18
    expect(result.current.analogPins).toEqual([14]);
  });

  it("handles for-loop with unterminated brace gracefully", () => {
    // Opening brace but no closing brace — extractBracedBody reaches end of string
    const code = `for (int i=0; i<=3; i++) { analogRead(i);`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    // Should still detect the analog pins from the body
    expect(result.current.analogPins).toEqual([14, 15, 16, 17]);
  });

  it("expands for-loop with nested braces in body", () => {
    // Nested braces (if-block inside for-loop) test the '{' branch in extractBracedBody
    const code = `for (int i=0; i<=1; i++) { if (true) { analogRead(i); } }`;
    const { result } = renderHook(() => useSketchAnalysis(code));

    expect(result.current.analogPins).toEqual([14, 15]);
  });
});
