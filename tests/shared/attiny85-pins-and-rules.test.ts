import { describe, expect, it } from "vitest";
import { boardAnalogPins, boardPinLabel, boardPins, boardPwmPins, isBoardPin, resolveBoardPin } from "@shared/board-pins";
import { boardPinAliases } from "@shared/boards";
import { CodeParser } from "@shared/code-parser";
import { analyzeStaticIO } from "@shared/io-registry-parser";
import { pinContext } from "@shared/parsers/pin-context";

const pinsOf = (code: string) => analyzeStaticIO(code, { board: "attiny85" }).pins.map((pin) => pin.pinId);
const warnings = (code: string) =>
  new CodeParser(undefined, undefined, "attiny85").parseHardwareCompatibility(code).map((message) => message.message);

describe("ATtiny85 pins (plan P6.4)", () => {
  it("has the pins 0–5; A0–A3 are second names of 5, 2, 4, 3", () => {
    expect(boardPins("attiny85")?.map((pin) => [pin.pin, pin.name, pin.analogName ?? ""])).toEqual([
      [0, "0", ""], [1, "1", ""], [2, "2", "A1"], [3, "3", "A3"], [4, "4", "A2"], [5, "5", "A0"],
    ]);
    expect(isBoardPin("attiny85", 6)).toBe(false);
    expect(boardPwmPins("attiny85")).toEqual([0, 1, 4]);
    expect(boardAnalogPins("attiny85").map((pin) => pin.analogName)).toEqual(["A1", "A3", "A2", "A0"]);
    expect(boardPinLabel("attiny85", 2)).toBe("2");
  });

  it("resolves A1, a1 and LED_BUILTIN the way the core does", () => {
    expect(resolveBoardPin("attiny85", "A1")).toBe(2);
    expect(resolveBoardPin("attiny85", "a0")).toBe(5);
    expect(resolveBoardPin("attiny85", "LED_BUILTIN")).toBe(1);
    expect(resolveBoardPin("attiny85", "A4")).toBeUndefined();
    expect(boardPinAliases("attiny85")).toMatchObject({ A0: 5, A1: 2, A2: 4, A3: 3, LED_BUILTIN: 1 });
  });

  it("gives the parsers the analog names and the software Serial on 0/1", () => {
    const context = pinContext("attiny85");
    // As in ATTinyCore: A<n> is 0x80 | n, which every pin function maps to its pin.
    expect(context.builtinConstants()).toEqual({ LED_BUILTIN: 1, A0: 0x80, A1: 0x81, A2: 0x82, A3: 0x83 });
    expect(context.callPin(0x81, "digitalWrite")).toBe(2);
    expect(context.callPin(1, "analogRead")).toBe(2);
    expect(context.callPin(1, "digitalWrite")).toBe(1);
    expect(context.softwareSerialPins()).toEqual({ tx: 0, rx: 1 });
    expect(context.role(5)).toBe("reset");
    expect(context.serialPortCount()).toBe(1);
    expect(pinContext("uno").softwareSerialPins()).toBeUndefined();
  });
});

describe("static analysis and rules for the ATtiny85 (plan P6.4)", () => {
  it("maps A1 and analogRead(1) to pin 2, as the core does (analogRead takes the channel)", () => {
    expect(pinsOf("void loop(){ analogRead(A1); }")).toEqual([2]);
    expect(pinsOf("void loop(){ analogRead(1); }")).toEqual([2]);
    expect(pinsOf("void loop(){ analogRead(A0); }")).toEqual([5]);
    expect(pinsOf("void loop(){ digitalWrite(6, HIGH); }")).toEqual([]);
  });

  it("warns about digital use of the RESET pin, not about analogRead(A0)", () => {
    expect(warnings("void setup(){ pinMode(5, OUTPUT); } void loop(){ digitalWrite(5, HIGH); }").filter((m) => m.includes("RESET"))).toHaveLength(2);
    expect(warnings("void setup(){} void loop(){ analogRead(A0); }").some((m) => m.includes("RESET"))).toBe(false);
  });

  it("warns about other use of the Serial pins only when the sketch uses Serial", () => {
    const withSerial = warnings("void setup(){ Serial.begin(9600); pinMode(0, OUTPUT); analogWrite(1, 10); } void loop(){ Serial.println(1); }");
    expect(withSerial.filter((m) => m.includes("Serial TX"))).toHaveLength(1);
    expect(withSerial.filter((m) => m.includes("Serial RX"))).toHaveLength(1);
    expect(warnings("void setup(){ pinMode(0, OUTPUT); } void loop(){ digitalWrite(0, HIGH); }").some((m) => m.includes("Serial"))).toBe(false);
    expect(warnings("// Serial.begin(9600);\nvoid setup(){ pinMode(1, OUTPUT); } void loop(){}").some((m) => m.includes("Serial"))).toBe(false);
  });

  it("names the PWM pins of the ATtiny85 and refuses Serial1", () => {
    expect(warnings("void setup(){} void loop(){ analogWrite(3, 10); }")).toContainEqual(expect.stringContaining("PWM pins: 0, 1, 4"));
    const serial = new CodeParser(undefined, undefined, "attiny85").parseSerialConfiguration("void setup(){ Serial1.begin(9600); } void loop(){ Serial1.println(1); }");
    expect(serial.map((m) => m.message)).toContainEqual(expect.stringContaining("Serial1 does not exist on ATtiny85"));
  });

  it("leaves the Uno without the new rules", () => {
    const uno = new CodeParser(undefined, undefined, "uno").parseHardwareCompatibility("void setup(){ Serial.begin(9600); pinMode(1, OUTPUT); pinMode(5, OUTPUT); } void loop(){}");
    expect(uno.some((m) => m.message.includes("RESET") || m.message.includes("Serial TX"))).toBe(false);
  });
});

describe("sketchSerialBaud (plan P6.5)", () => {
  it("reads an active Serial.begin() literal, not a commented one", async () => {
    const { sketchSerialBaud } = await import("@shared/parser-patterns");
    expect(sketchSerialBaud("void setup(){ Serial.begin(9600); }")).toBe(9600);
    expect(sketchSerialBaud("// Serial.begin(4800);\nvoid setup(){ Serial.begin( 19200 ); }")).toBe(19200);
    expect(sketchSerialBaud("// Serial.begin(4800);\nvoid setup(){}")).toBeUndefined();
    expect(sketchSerialBaud("const long BAUD = 9600; void setup(){ Serial.begin(BAUD); }")).toBeUndefined();
  });
});
