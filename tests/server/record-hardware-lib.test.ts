import { describe, expect, it } from "vitest";
import { acceptedCase, baudOf, lineDiff, normalizeRecording, stepsOf } from "../../scripts/record-hardware-lib";

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
});
