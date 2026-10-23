import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CPU, avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { ATTINY85, SoftwareUart, avr8jsSramParameter, buildSimulationImage, erasedEeprom, loadSimulationImage } from "../src/index";

const CLOCK_HZ = 8_000_000;

/** An ATtiny85 with the software UART on PB0 (TX) and PB1 (RX), as ATTinyCore wires `Serial`. */
function tinyWithSerial(fixture: string) {
  const hex = readFileSync(join(__dirname, "fixtures", `attiny85-${fixture}.hex`), "utf8");
  const cpu = new CPU(loadSimulationImage(buildSimulationImage({ board: "attiny85", hex })).progMem, avr8jsSramParameter(ATTINY85.memory));
  const peripherals = ATTINY85.createPeripherals(cpu, CLOCK_HZ, erasedEeprom(ATTINY85.eepromBytes));
  const port = peripherals.ports.get("B");
  if (!port) throw new Error("port B missing");
  const uart = new SoftwareUart(cpu, port, CLOCK_HZ);
  const bytes: number[] = [];
  uart.onByteTransmit = (byte) => bytes.push(byte);
  const text = () => new TextDecoder().decode(new Uint8Array(bytes)).replaceAll("\r\n", "\n");
  const run = (ms: number, until?: () => boolean) => {
    const end = cpu.cycles + (ms * CLOCK_HZ) / 1000;
    while (cpu.cycles < end && !until?.()) {
      for (let i = 0; i < 200; i++) {
        avrInstruction(cpu);
        cpu.tick();
      }
    }
  };
  return { cpu, peripherals, uart, bytes, text, run };
}

describe("software UART of the ATtiny85 (plan P6.3)", () => {
  it("decodes TinySoftwareSerial output at 9600 baud, UTF-8 and numbers included", () => {
    const tiny = tinyWithSerial("tiny_serial");
    tiny.peripherals.adc.channelValues[1] = 2.5;
    tiny.peripherals.adc.channelValues[3] = 0.5;
    tiny.run(2000, () => tiny.text().includes("DONE\n"));

    const lines = tiny.text().split("\n");
    expect(lines.slice(0, 3)).toEqual(["int 32767 + 1 = -32768", "print(2.5) = 2.50", "Umlaut: äöü"]);
    expect(Number(lines[3].replace("delay(587) = ", ""))).toBeGreaterThanOrEqual(585);
    expect(lines.slice(4)).toEqual(["A1 VCC = 512", "A3 1V1 = 465", "A3 2V56 = 200", "RAMEND = 0x25F", expect.stringMatching(/^SP at setup = 0x25[0-9A-F]$/), "DONE", ""]);
    expect(tiny.uart.baudRate).toBe(9600);
  });

  it("finds another standard baud rate from the line", () => {
    const tiny = tinyWithSerial("tiny_serial_19200");
    tiny.run(500, () => tiny.text().includes("DONE\n"));
    expect(tiny.text()).toBe("fast 19200\nDONE\n");
    expect(tiny.uart.baudRate).toBe(19200);
  });

  it("decodes a byte without enough edges with the configured baud rate once the line is idle", () => {
    const tiny = tinyWithSerial("tiny_serial_ff");
    tiny.uart.configuredBaud = 9600;
    tiny.run(200);
    expect(tiny.bytes).toEqual([0xff]);
  });

  it("receives through the analog comparator after Serial.begin() and answers", () => {
    const tiny = tinyWithSerial("tiny_echo");
    tiny.run(500, () => tiny.text().includes("ready\n"));
    expect(tiny.uart.rxEnable).toBe(true);

    const pending = [..."21\n"].map((char) => char.codePointAt(0) as number);
    tiny.uart.onRxComplete = () => {
      const next = pending.shift();
      if (next !== undefined) tiny.uart.writeByte(next);
    };
    tiny.uart.writeByte(pending.shift() as number);
    tiny.run(3000, () => tiny.text().includes("twice"));
    tiny.run(50);

    expect(tiny.text()).toBe("ready\ngot 21\ntwice 42\n");
  });

  it("refuses input while the receiver is off or a byte is on the line", () => {
    const tiny = tinyWithSerial("tiny_echo");
    expect(tiny.uart.rxEnable).toBe(false); // before Serial.begin()
    expect(tiny.uart.writeByte(0x31)).toBe(false);
    tiny.run(500, () => tiny.text().includes("ready\n"));
    expect(tiny.uart.writeByte(0x31)).toBe(true);
    expect(tiny.uart.rxBusy).toBe(true);
    expect(tiny.uart.writeByte(0x32)).toBe(false);
  });
});

describe("software UART line decoding (synthetic waveforms)", () => {
  /** An ATtiny85 without program whose PB0 is set by the test at exact cycles. */
  function line() {
    const cpu = new CPU(new Uint16Array(ATTINY85.flashBytes / 2), avr8jsSramParameter(ATTINY85.memory));
    const port = ATTINY85.createPeripherals(cpu, CLOCK_HZ, erasedEeprom(ATTINY85.eepromBytes)).ports.get("B");
    if (!port) throw new Error("port B missing");
    const uart = new SoftwareUart(cpu, port, CLOCK_HZ);
    const bytes: number[] = [];
    uart.onByteTransmit = (byte) => bytes.push(byte);
    cpu.writeData(0x28, 0x4b); // ACSR as Serial.begin() sets it: bandgap, interrupt on, rising edge
    cpu.writeData(0x37, 0x01); // DDRB: PB0 output
    cpu.writeData(0x38, 0x01); // idle high
    const at = (cycle: number, level: 0 | 1) => {
      while (cpu.cycles < cycle) {
        cpu.cycles++;
        cpu.tick();
      }
      cpu.writeData(0x38, level);
    };
    const frame = (start: number, byte: number, bit: number) => {
      [0, ...Array.from({ length: 8 }, (_, index) => (byte >> index) & 1), 1].forEach((level, index) => at(Math.round(start + index * bit), level as 0 | 1));
      return start + 10 * bit;
    };
    const idle = (cycles: number) => at(cpu.cycles + cycles, 1);
    return { cpu, uart, bytes, at, frame, idle };
  }

  it("keeps a start bit that follows a set-up pulse closely", () => {
    const { uart, bytes, at, frame, idle } = line();
    const bit = CLOCK_HZ / 9600;
    at(1_000, 0);
    at(1_003, 1); // 3-cycle pulse, as when the core configures the pin
    let next = 1_100;
    for (let i = 0; i < 6; i++) next = frame(next, 0x55, bit);
    idle(20 * bit);
    expect(uart.baudRate).toBe(9600);
    expect(bytes).toEqual(Array(6).fill(0x55));
  });

  it("sends nothing while Serial is not active (PB0 used as an ordinary pin)", () => {
    const { cpu, bytes, frame, idle } = line();
    cpu.writeData(0x28, 0x80); // ACSR: comparator off, as before Serial.begin() or after Serial.end()
    frame(1_000, 0x00, CLOCK_HZ / 9600);
    idle(40 * (CLOCK_HZ / 9600));
    expect(bytes).toEqual([]);
  });

  it("ignores PB0 while timer 0 drives it as PWM (OC0A)", () => {
    const { cpu, bytes, frame, idle } = line();
    cpu.writeData(0x4a, 0x83); // TCCR0A: COM0A1, fast PWM
    frame(1_000, 0x00, CLOCK_HZ / 9600);
    idle(40 * (CLOCK_HZ / 9600));
    expect(bytes).toEqual([]);
  });
});
