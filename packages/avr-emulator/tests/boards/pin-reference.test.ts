import { describe, expect, it } from "vitest";
import { boardPinReference, boardReferenceContacts } from "../../src/boards";

describe("board pin capability reference", () => {
  it.each([["uno", 20], ["nano", 22], ["mega2560", 70], ["attiny85", 6]] as const)(
    "keeps every signal pin of %s distinct from reference contacts",
    (board, count) => {
      const pins = boardPinReference(board);
      expect(pins).toHaveLength(count);
      expect(new Set(pins.map(p => p.hardware.pin)).size).toBe(count);
      expect(boardReferenceContacts(board).every(contact => !("pin" in contact))).toBe(true);
    },
  );

  it.each(["uno", "nano"] as const)("maps %s I2C, SPI and UART from the pinned core", board => {
    const pins = boardPinReference(board);
    const assignments = (bus: string) => pins.flatMap(p => p.buses.filter(b => b.interface === bus).map(b => [p.hardware.pin, b.signal]));
    expect(assignments("i2c")).toEqual([[18, "SDA"], [19, "SCL"]]);
    expect(assignments("spi")).toEqual([[10, "SS"], [11, "MOSI"], [12, "MISO"], [13, "SCK"]]);
    expect(assignments("serial")).toEqual([[0, "RX"], [1, "TX"]]);
    expect(pins.find(p => p.hardware.pin === 2)?.externalInterrupt).toBe(0);
    expect(pins.find(p => p.hardware.pin === 3)?.externalInterrupt).toBe(1);
    expect(pins.find(p => p.hardware.pin === 14)?.pinChange).toEqual({ index: 8, coreSupported: true });
  });

  it("keeps Nano A6/A7 analog-only, without inferred interrupts or buses", () => {
    const pins = boardPinReference("nano").filter(p => p.hardware.pin >= 20);
    expect(pins.map(p => [p.hardware.label, p.hardware.adcChannel, p.hardware.port, p.pinChange, p.externalInterrupt, p.buses])).toEqual([
      ["A6", 6, undefined, undefined, undefined, []],
      ["A7", 7, undefined, undefined, undefined, []],
    ]);
  });

  it("uses the Mega's bus pins and all four Serial ports", () => {
    const pins = boardPinReference("mega2560");
    const buses = pins.flatMap(p => p.buses.map(b => [p.hardware.pin, b.interface, b.signal, b.serialPort]));
    expect(buses.filter(b => b[1] === "i2c")).toEqual([[20, "i2c", "SDA", undefined], [21, "i2c", "SCL", undefined]]);
    expect(buses.filter(b => b[1] === "spi").map(b => [b[0], b[2]])).toEqual([[50, "MISO"], [51, "MOSI"], [52, "SCK"], [53, "SS"]]);
    expect(buses.filter(b => b[1] === "serial")).toEqual([
      [0, "serial", "RX", 0], [1, "serial", "TX", 0],
      [14, "serial", "TX", 3], [15, "serial", "RX", 3],
      [16, "serial", "TX", 2], [17, "serial", "RX", 2],
      [18, "serial", "TX", 1], [19, "serial", "RX", 1],
    ]);
    expect(pins.filter(p => p.externalInterrupt !== undefined).map(p => [p.hardware.pin, p.externalInterrupt])).toEqual([[2, 0], [3, 1], [18, 5], [19, 4], [20, 3], [21, 2]]);
  });

  it("distinguishes Mega register PCINT support from Arduino helper support", () => {
    const pins = boardPinReference("mega2560");
    expect(pins.filter(p => p.pinChange && !p.pinChange.coreSupported).map(p => [p.hardware.pin, p.pinChange?.index])).toEqual([[0, 8], [14, 10], [15, 9]]);
    expect(pins.find(p => p.hardware.pin === 62)?.pinChange).toEqual({ index: 16, coreSupported: true });
    expect(pins.find(p => p.hardware.pin === 2)?.pinChange).toBeUndefined();
  });

  it("shows ATtiny USI master roles alongside software UART and RESET constraints", () => {
    const pins = boardPinReference("attiny85");
    expect(pins[0].buses).toEqual([
      { interface: "i2c", peripheral: "usi", signal: "SDA", simulation: "not-modeled" },
      { interface: "spi", peripheral: "usi", signal: "MISO", mode: "master", simulation: "not-modeled" },
      { interface: "serial", peripheral: "software", signal: "TX", serialPort: 0, simulation: "modeled" },
    ]);
    expect(pins[1].buses.find(b => b.interface === "spi")?.signal).toBe("MOSI");
    expect(pins[2].externalInterrupt).toBe(0);
    expect(pins[4].hardware).toMatchObject({ label: "PB4", analogName: "A2", pwm: { timer: 1, channel: "B" } });
    expect(pins[5].hardware.role).toBe("reset");
    expect(pins[5].pinChange).toEqual({ index: 5, coreSupported: true });
  });

  it("does not imply that the listed hardware bus is emulated", () => {
    for (const board of ["uno", "nano", "mega2560", "attiny85"] as const) {
      for (const pin of boardPinReference(board)) {
        for (const bus of pin.buses) expect(bus.simulation).toBe(bus.interface === "serial" ? "modeled" : "not-modeled");
      }
    }
  });

  it("includes nonprogrammable power/control contacts without duplicating ATtiny RESET", () => {
    expect(boardReferenceContacts("uno").map(c => c.label)).toEqual(["5V", "3.3V", "GND", "VIN", "RESET", "AREF", "IOREF", "NC"]);
    expect(boardReferenceContacts("nano").map(c => c.label)).not.toContain("IOREF");
    expect(boardReferenceContacts("mega2560").map(c => c.label)).toContain("AREF");
    expect(boardReferenceContacts("attiny85").map(c => c.label)).toEqual(["VCC", "GND"]);
  });
});
