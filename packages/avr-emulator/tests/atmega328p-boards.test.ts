import { CPU } from "avr8js";
import { describe, expect, it } from "vitest";
import { ATMEGA328P, NANO, UNO, boardHardware, hasBoardHardware, mcuProfile } from "../src/index";
import { machineFromFixture, runSerial } from "./machine-helpers";

describe("board hardware Uno and Nano", () => {
  it("numbers the Uno pins 0–19 with A0–A5 as 14–19 on port C", () => {
    expect(UNO.pins.map((p) => p.pin)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(UNO.pins.find((p) => p.pin === 14)).toEqual({ pin: 14, label: "A0", port: { port: "C", bit: 0 }, adcChannel: 0 });
    expect(UNO.pins.find((p) => p.pin === 13)?.port).toEqual({ port: "B", bit: 5 });
    expect(UNO.pins.find((p) => p.pin === 7)?.port).toEqual({ port: "D", bit: 7 });
  });

  it("marks PWM pins 3, 5, 6, 9, 10, 11 with their timer channels and 0/1 as serial", () => {
    const pwm = UNO.pins.filter((p) => p.pwm).map((p) => [p.pin, `${p.pwm?.timer}${p.pwm?.channel}`]);

    expect(pwm).toEqual([[3, "2B"], [5, "0B"], [6, "0A"], [9, "1A"], [10, "1B"], [11, "2A"]]);
    expect(UNO.pins.filter((p) => p.role === "serial").map((p) => p.pin)).toEqual([0, 1]);
    expect(UNO.serialPorts).toEqual([{ index: 0, kind: "usart", usart: 0, rxPin: 0, txPin: 1 }]);
  });

  it("adds A6/A7 as analog-only pins 20/21 on the Nano", () => {
    expect(NANO.pins.slice(0, 20)).toEqual(UNO.pins);
    expect(NANO.pins.slice(20)).toEqual([{ pin: 20, label: "A6", adcChannel: 6 }, { pin: 21, label: "A7", adcChannel: 7 }]);
  });

  it("uses each port bit and ADC channel at most once", () => {
    for (const board of [UNO, NANO]) {
      const bits = board.pins.flatMap((p) => (p.port ? [`${p.port.port}${p.port.bit}`] : []));
      const channels = board.pins.flatMap((p) => (p.adcChannel === undefined ? [] : [p.adcChannel]));
      expect(new Set(bits).size).toBe(bits.length);
      expect(new Set(channels).size).toBe(channels.length);
    }
  });

  it("knows the boards with a profile and refuses the others for now", () => {
    expect(boardHardware("nano")).toBe(NANO);
    expect(hasBoardHardware("uno")).toBe(true);
    expect(hasBoardHardware("mega2560")).toBe(false);
    expect(() => boardHardware("attiny85")).toThrow(/no hardware profile yet/);
    expect(() => mcuProfile("atmega2560")).toThrow(/no profile yet/);
  });
});

describe("ATmega328P machine", () => {
  it.each(["uno", "nano"] as const)("runs int-probe on the %s like the real board (proposal section 2)", (board) => {
    expect(runSerial(machineFromFixture(board, `${board}-int_probe.hex`))).toBe(
      [
        "int 32767 + 1 = -32768",
        "unsigned int 65535 + 1 = 0",
        "int 300 * 200 = -5536",
        "sizeof int/long/float/double = 2/4/4/4",
        "print(2.5) = 2.50",
        "DONE",
        "",
      ].join("\n"),
    );
  });

  it("ends the data space at RAMEND 0x08FF with SP there after reset", () => {
    const { cpu } = machineFromFixture("uno", "uno-memory_probe.hex");

    expect(cpu.data).toHaveLength(0x900);
    expect(cpu.SP).toBe(0x8ff);
  });

  it.each(["uno", "nano"] as const)("shows the sketch the memory layout of the ATmega328P on the %s", (board) => {
    const lines = runSerial(machineFromFixture(board, `${board}-memory_probe.hex`)).split("\n");
    const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);

    // Derived: RAMEND and E2END from the datasheet, __bss_end from avr-nm (0x800210).
    expect(value("RAMEND = 0x")).toBe("8FF");
    expect(value("__bss_end = 0x")).toBe("210");
    expect(value("E2END = ")).toBe("1023");
    expect(value("EEPROM[17] = ")).toBe("42");
    // The stack starts at RAMEND, so setup() runs a few bytes below it and the
    // free RAM is the gap between stack and .bss.
    const sp = Number.parseInt(value("SP in setup = 0x") ?? "", 16);
    expect(sp).toBeGreaterThan(0x8f0);
    expect(sp).toBeLessThan(0x8ff);
    expect(Math.abs(Number(value("free = ")) - (sp - 0x210))).toBeLessThanOrEqual(16);
  });

  it("reads A0–A7 through the ADC; the Uno has no A6/A7 pins, so they read 0 V", () => {
    const run = (board: "uno" | "nano") => {
      const machine = machineFromFixture(board, `${board}-analog_probe.hex`);
      const volts = [0, 0.5, 1, 2, 2.5, 3.42, 4, 5];
      for (const pin of machine.board.pins) {
        if (pin.adcChannel !== undefined) machine.peripherals.adc.channelValues[pin.adcChannel] = volts[pin.adcChannel];
      }
      return runSerial(machine).split("\n").slice(0, 8).map((line) => Number(line.split(" = ")[1]));
    };

    // floor(V / 5 * 1024), capped at 1023 (datasheet formula, avr8js rounding)
    expect(run("nano")).toEqual([0, 102, 204, 409, 512, 700, 819, 1023]);
    expect(run("uno")).toEqual([0, 102, 204, 409, 512, 700, 0, 0]);
  });

  it("runs the clock at 16 MHz and offers 1 KiB of EEPROM", () => {
    const machine = machineFromFixture("uno", "uno-int_probe.hex");

    expect(machine.peripherals.clock.frequency).toBe(16_000_000);
    expect(machine.mcu).toBe(ATMEGA328P);
    expect(machine.peripherals.ports.size).toBe(3);
    expect(machine.peripherals.timers).toHaveLength(3);
  });

  it("refuses an image whose flash size does not fit the MCU", async () => {
    const { createMachine } = await import("../src/index");
    const progMem = new Uint16Array(1024);

    expect(() => createMachine({ board: "uno", mcu: "atmega328p", progMem, flashBytes: 2, sha256: "", symbols: { functions: {}, data: {} } })).toThrow(/has 2048 bytes of flash/);
    expect(new CPU(progMem)).toBeInstanceOf(CPU);
  });
});
