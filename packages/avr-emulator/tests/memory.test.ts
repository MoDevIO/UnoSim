import { CPU } from "avr8js";
import { describe, expect, it } from "vitest";
import { AVR8JS_DATA_SPACE_OFFSET, avr8jsSramParameter, ramEnd } from "../src/index";

// Datasheet values; the expected parameters are plan section 4.3.
const MCUS = [
  { name: "ATmega328P", layout: { sramStart: 0x100, sramBytes: 2048 }, ramEnd: 0x08ff, parameter: 2048 },
  { name: "ATmega2560", layout: { sramStart: 0x200, sramBytes: 8192 }, ramEnd: 0x21ff, parameter: 8448 },
  { name: "ATtiny85", layout: { sramStart: 0x60, sramBytes: 512 }, ramEnd: 0x025f, parameter: 352 },
] as const;

describe("memory layout", () => {
  it.each(MCUS)("derives RAMEND and the avr8js parameter for the $name", (mcu) => {
    expect(ramEnd(mcu.layout)).toBe(mcu.ramEnd);
    expect(avr8jsSramParameter(mcu.layout)).toBe(mcu.parameter);
  });

  it.each(MCUS)("makes avr8js end the data space at RAMEND and reset SP there for the $name", (mcu) => {
    const cpu = new CPU(new Uint16Array(0x100), avr8jsSramParameter(mcu.layout));

    expect(cpu.data).toHaveLength(mcu.ramEnd + 1);
    expect(cpu.SP).toBe(mcu.ramEnd);
  });

  it("documents why the default must not be used: it ends the data space at 0x20FF", () => {
    const cpu = new CPU(new Uint16Array(0x100));

    expect(cpu.data).toHaveLength(8192 + AVR8JS_DATA_SPACE_OFFSET);
    expect(cpu.SP).toBe(0x20ff);
  });

  it.each([
    { sramStart: -1, sramBytes: 512 },
    { sramStart: 0x60, sramBytes: 0 },
    { sramStart: 0x60, sramBytes: 1.5 },
    { sramStart: Number.NaN, sramBytes: 512 },
  ])("rejects an invalid layout %o", (layout) => {
    expect(() => ramEnd(layout)).toThrow(RangeError);
  });

  it("rejects a data space that avr8js cannot represent", () => {
    expect(() => avr8jsSramParameter({ sramStart: 0x20, sramBytes: 0x40 })).toThrow(/too small/);
  });
});
