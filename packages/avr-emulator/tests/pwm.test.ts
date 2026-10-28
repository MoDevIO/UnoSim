import { avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { ATMEGA328P, PinModel, type PinSnapshot, type TimerRegisters, pwmDuty, pwmRegisterAddresses } from "../src/index";
import { machineFromFixture, runWithEvents } from "./machine-helpers";

/** Runs the PWM probe and records the state of the named pin whenever a line `P<pin>=<value>` (or `D<pin> …`) ends. */
function runProbe(): Map<string, PinSnapshot> {
  const machine = machineFromFixture("uno", "uno-pwm_probe.hex");
  const pins = new PinModel(machine);
  const seen = new Map<string, PinSnapshot>();
  let line = "";
  machine.peripherals.usarts[0].onByteTransmit = (byte) => {
    const char = String.fromCodePoint(byte);
    if (char !== "\n") {
      line += char.trim();
      return;
    }
    const pin = /^[PD](\d+)/.exec(line)?.[1];
    if (pin) seen.set(line, pins.state(Number(pin)));
    line = "";
  };
  const { cpu } = machine;
  while (!seen.has("DONE") && cpu.cycles < 16_000_000) {
    avrInstruction(cpu);
    cpu.tick();
    if (line === "DONE") seen.set("DONE", pins.state(13));
  }
  return seen;
}

describe("PWM observation (plan P1.5)", () => {
  const seen = runProbe();

  it.each([3, 5, 6, 9, 10, 11])("reports the duty cycle of pin %i for 1, 25, 128, 254", (pin) => {
    for (const value of [1, 25, 128, 254]) {
      expect(seen.get(`P${pin}=${value}`), `P${pin}=${value}`).toEqual({ pin, mode: "OUTPUT", level: value >= 128 ? 1 : 0, pwm: value });
    }
  });

  it.each([3, 5, 6, 9, 10, 11])("shows analogWrite(%i, 0|255) as a digital output like the core", (pin) => {
    expect(seen.get(`P${pin}=0`)).toEqual({ pin, mode: "OUTPUT", level: 0 });
    expect(seen.get(`P${pin}=255`)).toEqual({ pin, mode: "OUTPUT", level: 1 });
  });

  it("switches from PWM back to digital on digitalWrite", () => {
    expect(seen.get("D9LOW")).toEqual({ pin: 9, mode: "OUTPUT", level: 0 });
    expect(seen.get("D10HIGH")).toEqual({ pin: 10, mode: "OUTPUT", level: 1 });
  });

  it("does not report the edges of a running PWM signal as changes", () => {
    const machine = machineFromFixture("uno", "uno-pwm_probe.hex");
    const pins = new PinModel(machine);
    runWithEvents(machine, 200);
    pins.takeChanges();
    expect(pins.state(6)).toEqual({ pin: 6, mode: "OUTPUT", level: 0, pwm: 100 });
    expect(pins.state(9)).toEqual({ pin: 9, mode: "OUTPUT", level: 0, pwm: 30 });
    let edges = 0;
    machine.peripherals.ports.get("D")?.addListener(() => edges++);
    runWithEvents(machine, 50); // timer 0 toggles pin 6 at about 976 Hz

    expect(edges).toBeGreaterThan(90);
    expect(pins.takeChanges().changeCount).toBe(0);
  });
});

describe("pwmDuty", () => {
  const timer8: TimerRegisters = ATMEGA328P.timerRegisters[2];
  const timer16: TimerRegisters = ATMEGA328P.timerRegisters[1];
  const data = () => new Uint8Array(0x100);

  it("lists the registers to watch, both bytes of 16-bit registers", () => {
    expect(pwmRegisterAddresses(timer8)).toEqual([0xb0, 0xb1, 0xb3, 0xb4]);
    expect(pwmRegisterAddresses(timer16)).toEqual([0x80, 0x81, 0x88, 0x89, 0x8a, 0x8b, 0x86, 0x87]);
  });

  it("returns undefined without PWM: output disconnected, toggle mode, normal or CTC waveform", () => {
    const d = data();
    d[0xb3] = 100;
    d[0xb0] = 0b0000_0011; // fast PWM, COM2A = 00
    expect(pwmDuty(d, timer8, "A")).toBeUndefined();
    d[0xb0] = 0b0100_0011; // COM2A = 01
    expect(pwmDuty(d, timer8, "A")).toBeUndefined();
    d[0xb0] = 0b1000_0010; // CTC
    expect(pwmDuty(d, timer8, "A")).toBeUndefined();
    expect(pwmDuty(d, timer8, "C")).toBeUndefined(); // timer 2 has no channel C
  });

  it("inverts the duty cycle in inverting mode", () => {
    const d = data();
    d[0xb0] = 0b1100_0001; // phase correct, COM2A = 11
    d[0xb3] = 55;
    expect(pwmDuty(d, timer8, "A")).toBe(200);
  });

  it("uses OCRA as TOP in 8-bit modes 5 and 7 and clamps OCR above TOP", () => {
    const d = data();
    d[0xb0] = 0b0010_0011; // fast PWM, COM2B = 10
    d[0xb1] = 0b0000_1000; // WGM22 -> mode 7, TOP = OCR2A
    d[0xb3] = 100;
    d[0xb4] = 50;
    expect(pwmDuty(d, timer8, "B")).toBe(128);
    d[0xb4] = 200;
    expect(pwmDuty(d, timer8, "B")).toBe(255);
    d[0xb3] = 0;
    expect(pwmDuty(d, timer8, "B")).toBeUndefined();
  });

  it.each([
    ["phase correct 9-bit", 0b10, 0b0000, 0x1ff, 0x1ff],
    ["phase correct 10-bit", 0b11, 0b0000, 0x3ff, 0x200],
    ["fast PWM, TOP = ICR1", 0b10, 0b1_1000, 1000, 500],
    ["phase and frequency correct, TOP = OCR1A", 0b01, 0b1_0000, 400, 100],
  ])("scales 16-bit timer 1 in %s mode", (_name, wgmLow, tccrb, top, ocr) => {
    const d = data();
    d[0x80] = 0b0010_0000 | wgmLow; // COM1B = 10
    d[0x81] = tccrb;
    d[0x86] = top & 0xff; d[0x87] = top >> 8; // ICR1
    if (tccrb === 0b1_0000) { d[0x88] = top & 0xff; d[0x89] = top >> 8; } // OCR1A as TOP
    d[0x8a] = ocr & 0xff; d[0x8b] = ocr >> 8; // OCR1B
    const expected = Math.round((Math.min(ocr, top) * 255) / top);
    expect(pwmDuty(d, timer16, "B")).toBe(expected);
  });
});
