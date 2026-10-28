import { describe, expect, it } from "vitest";
import { ArrayEepromBackend, createMachine, erasedEeprom } from "../src/index";
import { machineFromFixture } from "./machine-helpers";

describe("EEPROM content", () => {
  it("starts erased, clears bits on write and sets them on erase, like the datasheet", () => {
    const memory = erasedEeprom(4);
    const backend = new ArrayEepromBackend(memory);
    backend.writeMemory(1, 0b1010_1010);
    backend.writeMemory(1, 0b1111_0000);

    expect([...memory]).toEqual([0xff, 0b1010_0000, 0xff, 0xff]);
    backend.eraseMemory(1);
    expect(backend.readMemory(1)).toBe(0xff);
  });

  it("ignores addresses beyond the EEPROM and reads them as erased", () => {
    const backend = new ArrayEepromBackend(erasedEeprom(2));
    backend.writeMemory(9, 0);
    backend.eraseMemory(9);

    expect(backend.readMemory(9)).toBe(0xff);
  });

  it("copies given content into a new machine and checks its size", () => {
    const machine = machineFromFixture("uno", "uno-int_probe.hex");
    const content = erasedEeprom(1024);
    content[3] = 7;
    const image = { board: "uno" as const, mcu: "atmega328p" as const, progMem: machine.cpu.progMem, flashBytes: 2, sha256: "", symbols: { functions: {}, data: {} } };
    const copy = createMachine(image, { eeprom: content });
    content[3] = 8;

    expect(copy.eeprom[3]).toBe(7);
    expect(() => createMachine(image, { eeprom: erasedEeprom(512) })).toThrow(/EEPROM content has 512 bytes, atmega328p has 1024/);
  });
});
