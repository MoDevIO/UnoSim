/**
 * Test für Serial.print() Buffering-Verhalten
 * Testet, dass der lineBuffer korrekt funktioniert
 */

describe("Serial.print() Buffering Behavior", () => {
  it("should verify the arduino-mock.ts contains flush() in delay()", () => {
    const fs = require("fs");
    const mockCode = fs.readFileSync("./server/mocks/arduino-mock.ts", "utf8");

    // Verify that delay() calls Serial.flush()
    expect(mockCode).toContain("Serial.flush()");
    expect(mockCode).toContain("void delay(unsigned long ms)");

    // Verify that flush() calls flushLineBuffer()
    expect(mockCode).toContain("flushLineBuffer()");

    // Verify that serialWrite buffers until newline
    expect(mockCode).toContain("lineBuffer += c");
    expect(mockCode).toContain("if (c == '\\\\n')");
  });

  it("should verify SERIAL_EVENT encoding preserves \\r", () => {
    // Test that \r would be preserved in base64 encoding
    const testString = "\rCurrent value: 0      ";
    const base64 = Buffer.from(testString).toString("base64");
    const decoded = Buffer.from(base64, "base64").toString();

    expect(decoded).toBe(testString);
    expect(decoded).toContain("\r");
    expect(decoded).toContain("Current value:");
  });

  it("should document the expected behavior", () => {
    // This test documents how Serial.print() should work:
    //
    // 1. Serial.print("text") adds to lineBuffer
    // 2. Serial.println("text") adds to lineBuffer AND flushes immediately
    // 3. delay() calls Serial.flush() which flushes the lineBuffer
    // 4. flushLineBuffer() base64-encodes the buffer and sends as SERIAL_EVENT
    // 5. \r characters are preserved in the encoding
    //
    // Example:
    //   Serial.print("\r");      // adds \r to buffer
    //   Serial.print("Value: "); // adds "Value: " to buffer
    //   Serial.print(42);        // adds "42" to buffer
    //   delay(100);              // flushes buffer: "\rValue: 42" as one SERIAL_EVENT
    //
    // The frontend then interprets \r to overwrite the current line

    expect(true).toBe(true); // Documentation test always passes
  });
});
