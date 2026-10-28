import { avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { AnalogInputs } from "../src/index";
import { machineFromFixture } from "./machine-helpers";

interface Scenario {
  readonly a0: number;
  readonly a5?: number;
  readonly aref?: number;
}

/** Applies each scenario for 20 ms and returns the last complete probe line of each. */
function probe(scenarios: readonly Scenario[]): number[][] {
  const machine = machineFromFixture("uno", "uno-adc_probe.hex");
  const analog = new AnalogInputs(machine);
  const { cpu } = machine;
  let line = "";
  let last: number[] = [];
  machine.peripherals.usarts[0].onByteTransmit = (byte) => {
    if (byte === 10) {
      last = line.trim().split(/\s+/).filter((part) => /^\d+$/.test(part)).map(Number);
      line = "";
    } else line += String.fromCodePoint(byte);
  };
  const results: number[][] = [];
  for (const scenario of scenarios) {
    analog.setAnalog(14, scenario.a0);
    analog.setAnalog(19, scenario.a5 ?? 0);
    if (scenario.aref !== undefined) analog.setArefVolts(scenario.aref);
    const end = cpu.cycles + 20 * 16_000;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
    results.push(last);
  }
  return results;
}

// Datasheet: ADC = floor(V_in / V_ref · 1024), at most 1023; V_in = (v + 0.5) / 1024 · 5 V.
const adc = (v: number, ref: number) => Math.min(1023, Math.floor((((v + 0.5) / 1024) * 5 * 1024) / ref));

describe("AnalogInputs (plan P1.6)", () => {
  it("makes analogRead() with the default reference return the slider value exactly", () => {
    const values = [0, 1, 2, 511, 512, 1022, 1023];
    const lines = probe(values.map((a0) => ({ a0, a5: 1023 - a0 })));

    expect(lines.map((l) => l[0])).toEqual(values);
    expect(lines.map((l) => l[3])).toEqual(values.map((v) => 1023 - v));
  });

  it("scales with the internal 1.1 V reference and saturates above it", () => {
    const values = [0, 1, 100, 200, 225, 226, 511];
    const lines = probe(values.map((a0) => ({ a0 })));

    expect(lines.map((l) => l[1])).toEqual(values.map((v) => adc(v, 1.1)));
    expect(lines.at(-1)?.[1]).toBe(1023);
  });

  it("uses VCC at AREF by default and a set AREF voltage for EXTERNAL", () => {
    const lines = probe([{ a0: 300 }, { a0: 300, aref: 2.5 }, { a0: 600, aref: 2.5 }]);

    expect(lines.map((l) => l[2])).toEqual([300, adc(300, 2.5), 1023]);
    expect(adc(300, 2.5)).toBe(601);
  });

  it("knows the analog pins of the board and rejects others and invalid values", () => {
    const nano = new AnalogInputs(machineFromFixture("nano", "nano-int_probe.hex"));
    const uno = new AnalogInputs(machineFromFixture("uno", "uno-int_probe.hex"));

    expect(nano.pins).toEqual([14, 15, 16, 17, 18, 19, 20, 21]);
    expect(uno.pins).toEqual([14, 15, 16, 17, 18, 19]);
    nano.setVolts(21, 3.3);
    expect(nano.volts(21)).toBe(3.3);
    expect(uno.volts(14)).toBe(0);
    expect(() => uno.setAnalog(20, 1)).toThrow(/not an analog input of uno/);
    expect(() => uno.setAnalog(14, 1024)).toThrow(RangeError);
    expect(() => uno.setAnalog(14, 1.5)).toThrow(RangeError);
    expect(() => uno.setVolts(14, 5.1)).toThrow(RangeError);
    expect(() => uno.setVolts(14, Number.NaN)).toThrow(RangeError);
    expect(() => uno.setArefVolts(0)).toThrow(RangeError);
  });
});
