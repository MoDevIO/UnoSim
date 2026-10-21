import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { ATMEGA2560, Emulator, MEGA2560, UNO, boardHardware, buildSimulationImage, createMachine, hasBoardHardware, loadSimulationImage, mcuProfile, runHeadless } from "../src/index";
import type { Machine } from "../src/index";
import { FakeClock } from "./fake-clock";
import { machineFromFixture } from "./machine-helpers";

const hexOf = (name: string): string => readFileSync(join(__dirname, "fixtures", `mega2560-${name}.hex`), "utf8");
const imageOf = (name: string) => loadSimulationImage(buildSimulationImage({ board: "mega2560", hex: hexOf(name) }));

/** Runs a Mega machine until `Serial` printed DONE or `maxMs` passed; returns the text of all four ports. */
function runPorts(machine: Machine, maxMs = 2000): string[] {
  const text = ["", "", "", ""];
  machine.peripherals.usarts.forEach((usart, index) => {
    usart.onByteTransmit = (byte) => {
      text[index] += String.fromCodePoint(byte);
    };
  });
  const { cpu } = machine;
  const end = (maxMs * machine.board.clockHz) / 1000;
  while (cpu.cycles < end && !text[0].includes("DONE")) {
    for (let i = 0; i < 1000; i++) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
  return text.map((port) => port.replaceAll("\r\n", "\n"));
}

describe("board hardware Mega 2560", () => {
  it("numbers the pins 0–69 with A0–A15 as 54–69", () => {
    expect(MEGA2560.pins.map((p) => p.pin)).toEqual(Array.from({ length: 70 }, (_, i) => i));
    expect(MEGA2560.pins.find((p) => p.pin === 54)).toEqual({ pin: 54, label: "A0", port: { port: "F", bit: 0 }, adcChannel: 0 });
    expect(MEGA2560.pins.find((p) => p.pin === 69)).toEqual({ pin: 69, label: "A15", port: { port: "K", bit: 7 }, adcChannel: 15 });
    expect(MEGA2560.pins.find((p) => p.pin === 13)?.port).toEqual({ port: "B", bit: 7 });
    expect(MEGA2560.pins.find((p) => p.pin === 42)?.port).toEqual({ port: "L", bit: 7 });
  });

  it("marks PWM on 2–13 and 44–46 with the timer channels of the core", () => {
    const pwm = MEGA2560.pins.filter((p) => p.pwm).map((p) => `${p.pin}:${p.pwm?.timer}${p.pwm?.channel}`);

    expect(pwm).toEqual(["2:3B", "3:3C", "4:0B", "5:3A", "6:4A", "7:4B", "8:4C", "9:2B", "10:2A", "11:1A", "12:1B", "13:0A", "44:5C", "45:5B", "46:5A"]);
  });

  it("has four serial ports on the pins of the core and the LED on 13", () => {
    expect(MEGA2560.serialPorts.map((s) => [s.index, s.usart, s.rxPin, s.txPin])).toEqual([[0, 0, 0, 1], [1, 1, 19, 18], [2, 2, 17, 16], [3, 3, 15, 14]]);
    expect(MEGA2560.ledBuiltin).toBe(13);
    expect(MEGA2560.pins.filter((p) => p.role === "serial").map((p) => p.pin)).toEqual([0, 1]);
  });

  it("uses each port bit and ADC channel once and every port bit exists on the MCU", () => {
    const bits = MEGA2560.pins.map((p) => `${p.port?.port}${p.port?.bit}`);
    const channels = MEGA2560.pins.flatMap((p) => (p.adcChannel === undefined ? [] : [p.adcChannel]));
    expect(new Set(bits).size).toBe(bits.length);
    expect(channels).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const machine = createMachine(imageOf("mega_probe"));
    for (const pin of MEGA2560.pins) expect(machine.peripherals.ports.has(pin.port?.port ?? "A"), pin.label).toBe(true);
  });

  it("is known with its MCU profile", () => {
    expect(boardHardware("mega2560")).toBe(MEGA2560);
    expect(hasBoardHardware("mega2560")).toBe(true);
    expect(mcuProfile("atmega2560")).toBe(ATMEGA2560);
    expect(UNO.pins).toHaveLength(20);
  });
});

describe("ATmega2560 machine", () => {
  it("has 11 ports, 6 timers, 4 USARTs, 16 ADC channels and 4 KiB of EEPROM", () => {
    const machine = createMachine(imageOf("mega_probe"));

    expect(machine.mcu).toBe(ATMEGA2560);
    expect(machine.peripherals.ports.size).toBe(11);
    expect(machine.peripherals.timers).toHaveLength(6);
    expect(machine.peripherals.usarts).toHaveLength(4);
    expect(machine.peripherals.adc.channelValues).toHaveLength(16);
    expect(machine.eeprom).toHaveLength(4096);
    expect(machine.cpu.pc22Bits).toBe(true);
  });

  it("ends the data space at RAMEND 0x21FF with SP there after reset", () => {
    const { cpu } = machineFromFixture("mega2560", "mega2560-mega_probe.hex");

    expect(cpu.data).toHaveLength(0x2200);
    expect(cpu.SP).toBe(0x21ff);
  });

  it("refuses an image whose flash size does not fit the MCU", () => {
    const small = { ...imageOf("mega_probe"), progMem: new Uint16Array(1024), flashBytes: 2048 };
    expect(() => createMachine(small)).toThrow(/has 2048 bytes of flash/);
  });

  it("runs the probe: all four serial ports, memory, time, ADC and timers of the core", () => {
    const machine = machineFromFixture("mega2560", "mega2560-mega_probe.hex");
    machine.peripherals.adc.channelValues[0] = 2.5;
    machine.peripherals.adc.channelValues[15] = 3.42; // A15 needs MUX5
    const [serial0, serial1, serial2, serial3] = runPorts(machine);
    const lines = serial0.split("\n");
    const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);

    expect(serial1).toBe("S1 hello\n");
    expect(serial2).toBe("S2 hello\n");
    expect(serial3).toBe("S3 hello\n");
    expect(value("int 32767 + 1 = ")).toBe("-32768");
    expect(value("sizeof int/long/double = ")).toBe("2/4/4");
    expect(Number(value("delay(587) = "))).toBeGreaterThanOrEqual(586);
    expect(Number(value("delay(587) = "))).toBeLessThanOrEqual(587);
    expect(value("A0 = ")).toBe("512"); // floor(2.5 / 5 · 1024)
    expect(value("A15 = ")).toBe("700"); // floor(3.42 / 5 · 1024)
    expect(value("timer of D44 = ")).toBe("18"); // TIMER5C
    expect(value("RAMEND = 0x")).toBe("21FF");
    expect(Number.parseInt(value("SP at setup = 0x") ?? "", 16)).toBeGreaterThan(0x21f0);
    expect(serial0).toContain("DONE");
  });

  it("derives the baud rates of the four ports from UBRR and U2X", () => {
    const machine = machineFromFixture("mega2560", "mega2560-mega_probe.hex");
    const baud = machine.peripherals.usarts.map((usart) => usart.baudRate);
    const changed = machine.peripherals.usarts.map(() => 0);
    machine.peripherals.usarts.forEach((usart, i) => {
      usart.onConfigurationChange = () => {
        changed[i] = usart.baudRate;
      };
    });
    runPorts(machine);

    expect(baud).toHaveLength(4);
    expect(changed).toEqual([117_647, 9_615, 19_230, 58_823]); // the core's rounding of 115200, 9600, 19200, 57600
  });

  it("drives the PWM registers of timers 0, 2, 3 and 5", () => {
    const machine = machineFromFixture("mega2560", "mega2560-mega_probe.hex");
    runPorts(machine);
    const word = (address: number) => machine.cpu.data[address] | (machine.cpu.data[address + 1] << 8);

    expect([word(0x12c), word(0x12a), word(0x128)]).toEqual([25, 128, 200]); // OCR5C, OCR5B, OCR5A for pins 44, 45, 46
    expect(word(0x9a)).toBe(77); // OCR3B, pin 2
    expect(machine.cpu.data[0xb4]).toBe(99); // OCR2B, pin 9
    expect(machine.cpu.data[0x47]).toBe(10); // OCR0A, pin 13
  });
});

describe("ATmega2560 pins and interrupts", () => {
  it("observes pins on all ports, PWM on timers 4 and 5 and the ADC channels above 7", () => {
    const result = runHeadless(imageOf("mega_io"), {
      simMs: 100,
      events: [[0, "adcVolts", 8, 1.5], [0, "adcVolts", 3, 4]],
      expectState: [
        [90, "pin", 22, "OUTPUT", 1],
        [90, "pin", 42, "OUTPUT", 1],
        [90, "pin", 7, "OUTPUT", 0],
        [90, "pin", 15, "INPUT_PULLUP", 1],
        [90, "pin", 62, "INPUT", 0],
        [90, "pwm", 8, 100],
        [90, "pwm", 46, 200],
      ],
    });

    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    // floor(1.5 / 5 · 1024) and floor(4 / 5 · 1024)
    expect(result.serial.get(0)?.replaceAll("\r\n", "\n")).toBe("1\n0\n307\n819\nDONE\n");
    expect(result.usages).toEqual(
      expect.arrayContaining([
        { pin: 22, fn: "pinMode", mode: "OUTPUT" },
        { pin: 42, fn: "pinMode", mode: "OUTPUT" },
        { pin: 7, fn: "pinMode", mode: "OUTPUT" },
        { pin: 15, fn: "pinMode", mode: "INPUT_PULLUP" },
        { pin: 62, fn: "pinMode", mode: "INPUT" },
        { pin: 8, fn: "analogWrite" },
        { pin: 46, fn: "analogWrite" },
        { pin: 62, fn: "digitalRead" },
        { pin: 15, fn: "digitalRead" },
        { pin: 62, fn: "analogRead" },
      ]),
    );
  });

  it("delivers INT0–INT5 and one pin-change interrupt per group on the falling edges of the pins", () => {
    const edge = (at: number, pin: number): [number, "pin", number, 0 | 1][] => [[at, "pin", pin, 0], [at + 5, "pin", pin, 1]];
    const result = runHeadless(imageOf("mega_interrupts"), {
      simMs: 400,
      events: [
        ...edge(50, 21), // INT0
        ...edge(60, 20), ...edge(70, 20), // INT1 twice
        ...edge(80, 19), // INT2
        ...edge(90, 18), // INT3
        ...edge(100, 2), ...edge(110, 2), ...edge(120, 2), // INT4 three times
        ...edge(130, 3), // INT5
        ...edge(140, 10), // PCINT0: the falling and the rising edge both count
        ...edge(150, 15), ...edge(160, 15), // PCINT1
        ...edge(170, 62), // PCINT2
      ],
    });

    expect(result.serial.get(0)?.replaceAll("\r\n", "\n")).toBe(
      "READY\nINT0=1 INT1=2 INT2=1 INT3=1 INT4=3 INT5=1 PCINT0=2 PCINT1=4 PCINT2=2\nDONE\n",
    );
  });

  it("keeps the vectors of the 328P out: timer and USART interrupts of timers 0–2 hit the Mega vectors", () => {
    const emulator = new Emulator(imageOf("mega_probe"), { clock: new FakeClock(), timeoutMs: 10_000 });
    emulator.advance(700);

    expect(emulator.takeSerialOutput().find((o) => o.port === 0)?.text).toContain("delay(587) = 58");
  });
});
