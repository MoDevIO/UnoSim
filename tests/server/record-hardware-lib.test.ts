import { describe, expect, it } from "vitest";
import { acceptedCase, baudOf, lineDiff, normalizeRecording, recordingToolchain, stepsOf, stripLeadingNoise } from "../../scripts/record-hardware-lib";

describe("hardware recording tool (plan 7.4)", () => {
  it("finds the baud rate of the sketch, ignoring comments", () => {
    expect(baudOf("void setup(){ Serial.begin(115200); }")).toBe(115200);
    expect(baudOf("void setup(){ Serial.begin( 9600 ); }")).toBe(9600);
    expect(baudOf("// Serial.begin(9600)\nvoid setup(){ Serial.begin(115200); }")).toBe(115200);
    expect(baudOf("/* Serial.begin(1) */ void setup(){}")).toBeUndefined();
  });

  it("turns stimuli into steps: serial text is sent, pins and voltages are instructions, ordered by time", () => {
    const steps = stepsOf([
      [900, "adcVolts", 0, 2.51],
      [100, "serial", "Hi\n"],
      [400, "pin", 2, 0],
      [700, "pin", 4, 1],
      [800, "adc", 5, 1.1],
    ]);

    expect(steps).toEqual([
      { atMs: 100, send: "Hi\n" },
      { atMs: 400, instruction: "connect pin 2 to GND (LOW)" },
      { atMs: 700, instruction: "connect pin 4 to 5V (HIGH)" },
      { atMs: 800, instruction: "apply 1.1 V to ADC channel 5 (A5)" },
      { atMs: 900, instruction: "apply 2.51 V to ADC channel 0 (A0)" },
    ]);
  });

  it("reads CRLF as LF and reports every differing line", () => {
    expect(normalizeRecording("a\r\nb\r\n")).toBe("a\nb\n");
    expect(lineDiff("a\nb\n", "a\nb\n")).toEqual([]);
    expect(lineDiff("a\nb\n", "a\nx\n")).toEqual(['line 2: expected "b", recorded "x"']);
    expect(lineDiff("a\n", "a\nb\n")).toHaveLength(2);
  });

  it("turns a case into a hardware case and keeps the earlier basis", () => {
    const result = acceptedCase({ board: "uno", provenance: "derived", basis: "datasheet", simMs: 100 }, "Arduino Uno R3", "arduino-cli 1.5.1, arduino:avr@1.8.8");

    expect(result).toMatchObject({ provenance: "hardware", recordedOn: "Arduino Uno R3", toolchain: "arduino-cli 1.5.1, arduino:avr@1.8.8", simMs: 100 });
    expect(result.basis).toBe("Recorded once on Arduino Uno R3 (serial output, arduino-cli 1.5.1, arduino:avr@1.8.8). Previous basis: datasheet");
  });

  it("names the toolchain of the board a recording was built with", () => {
    expect(recordingToolchain("uno")).toBe("arduino-cli 1.5.1, arduino:avr@1.8.8");
    expect(recordingToolchain("mega2560")).toBe("arduino-cli 1.5.1, arduino:avr@1.8.8");
    expect(recordingToolchain("attiny85")).toBe("arduino-cli 1.5.1, ATTinyCore 1.5.2 (avr-gcc of arduino:avr@1.8.8)");
  });

  describe("bridge noise ahead of the first line", () => {
    const matches = (line: string): boolean => line === "bool 1";

    it("leaves a clean recording alone", () => {
      expect(stripLeadingNoise("bool 1\r\nchar 1\r\n", matches)).toEqual({ text: "bool 1\r\nchar 1\r\n", stripped: "" });
    });

    it("strips a few leading bytes that are not text and reports them", () => {
      expect(stripLeadingNoise("\u0000\u00efbool 1\r\nchar 1\r\n", matches)).toEqual({ text: "bool 1\r\nchar 1\r\n", stripped: "\u0000\u00ef" });
    });

    it("does not strip printable text: that would be a real deviation of the sketch", () => {
      expect(stripLeadingNoise("xxbool 1\r\n", matches)).toEqual({ text: "xxbool 1\r\n", stripped: "" });
    });

    it("does not strip more than the limit, nor across a line break", () => {
      const noisy = `${"\u0001".repeat(9)}bool 1\r\n`;
      expect(stripLeadingNoise(noisy, matches).stripped).toBe("");
      expect(stripLeadingNoise("\u0001\nbool 1\r\n", matches).stripped).toBe("");
    });
  });
});
