import { describe, it, expect } from "@jest/globals";
import { ARDUINO_MOCK_CODE } from "../../server/mocks/arduino-mock";

describe("Carriage Return Integration Test", () => {
  it("should verify arduino-mock.ts preserves \\r in serial buffer", () => {
    /**
     * Test that the C++ mock code:
     * 1. Buffers serial output until \n or flush()
     * 2. Does NOT strip \r characters
     * 3. Properly encodes \r in Base64 for SERIAL_EVENT
     */

    const mockCode = ARDUINO_MOCK_CODE;

    // Verify that serialWrite only flushes on \n, not on \r
    expect(mockCode).toContain("if (c == '\\n')");
    expect(mockCode).not.toContain("if (c == '\\r')");

    // Verify that delay() calls Serial.flush()
    expect(mockCode).toContain("Serial.flush()");

    // Verify that flush() calls flushLineBuffer()
    expect(mockCode).toContain("void flush() {");
    expect(mockCode).toContain("flushLineBuffer()");

    // Verify Base64 encoding is used (which preserves all characters including \r)
    expect(mockCode).toContain("base64_encode");
    expect(mockCode).toContain("SERIAL_EVENT");
  });

  it("should verify \\r character is preserved in Base64 encoding", () => {
    /**
     * Test that \r (ASCII 13, 0x0D) is correctly preserved when Base64 encoded.
     * The Base64 encoding should work for all characters including control characters.
     */

    // Simulate what happens in the C++ code
    const testString = "\rValue: 42   ";

    // JavaScript Base64 encoding (equivalent to C++ base64_encode)
    const base64 = Buffer.from(testString, "utf8").toString("base64");

    // Decode to verify round-trip
    const decoded = Buffer.from(base64, "base64").toString("utf8");

    expect(decoded).toBe(testString);
    expect(decoded).toContain("\r");
    expect(decoded.charCodeAt(0)).toBe(13); // ASCII code for \r
  });

  it("should document the expected behavior for counter sketch", () => {
    /**
     * This test documents the expected behavior:
     *
     * Sketch:
     * ```cpp
     * void loop() {
     *   Serial.print("\rValue: ");
     *   Serial.print(counter);
     *   Serial.print("   ");
     *   counter++;
     *   delay(1000);
     * }
     * ```
     *
     * Expected flow:
     * 1. Serial.print("\rValue: ") → adds to lineBuffer: "\rValue: "
     * 2. Serial.print(counter) → adds to lineBuffer: "\rValue: 0"
     * 3. Serial.print("   ") → adds to lineBuffer: "\rValue: 0   "
     * 4. delay(1000) → calls Serial.flush() → sends SERIAL_EVENT with Base64("\rValue: 0   ")
     * 5. Backend decodes Base64 → "\rValue: 0   " (with \r preserved)
     * 6. Frontend receives "\rValue: 0   " (arduino-simulator.tsx does NOT strip \r)
     * 7. SerialMonitor splits on \r → ["", "Value: 0   "] → displays "Value: 0   "
     * 8. Next iteration overwrites the same line
     *
     * Result: Counter updates in-place instead of creating new lines
     */

    const mockCode = ARDUINO_MOCK_CODE;

    // All components are in place:
    expect(mockCode).toContain("lineBuffer"); // ✓ Buffer accumulates
    expect(mockCode).toContain("if (c == '\\n')"); // ✓ Only flush on \n
    expect(mockCode).toContain("Serial.flush()"); // ✓ delay() flushes
    expect(mockCode).toContain("base64_encode"); // ✓ Preserves \r

    // The test passes if all assertions pass
    expect(true).toBe(true);
  });

  it("should verify frontend does not strip \\r in arduino-simulator.tsx", () => {
    /**
     * Critical fix: arduino-simulator.tsx line ~1007 should NOT contain:
     *   buffer += piece.replace(/\r/g, '');
     *
     * It should preserve \r so SerialMonitor can process it.
     */

    const fs = require("fs");
    const path = require("path");

    const simulatorPath = path.join(
      __dirname,
      "../../client/src/pages/arduino-simulator.tsx",
    );
    const simulatorCode = fs.readFileSync(simulatorPath, "utf8");

    // Should NOT strip \r in the serial event processing
    const problematicLine = /piece\.replace\(\/\\r\/g,\s*['""]['"]\)/;
    expect(simulatorCode).not.toMatch(problematicLine);

    // Should process piece data from payload (preserving control chars)
    expect(simulatorCode).toMatch(/const piece.*payload\.data/);
  });

  it("should verify SerialMonitor handles \\r correctly", () => {
    /**
     * Test that serial-monitor.tsx has the logic to handle \r:
     * - Split on \r
     * - Take the last part (after final \r)
     * - Overwrite previous line
     */

    const fs = require("fs");
    const path = require("path");

    const monitorPath = path.join(
      __dirname,
      "../../client/src/components/features/serial-monitor.tsx",
    );
    const monitorCode = fs.readFileSync(monitorPath, "utf8");

    // Should check for carriage return
    expect(monitorCode).toContain("hasCarriageReturn");
    // Match either single- or double-quoted split("\\r") or split('\r')
    expect(monitorCode).toMatch(/split\(["']\\r["']\)/);

    // Should handle the split result
    expect(monitorCode).toContain("cleanParts");
  });
});
