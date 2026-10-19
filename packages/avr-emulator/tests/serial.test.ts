import { avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { type Machine, SERIAL_INPUT_LIMITS, SerialPorts, Utf8StreamDecoder, encodeUtf8 } from "../src/index";
import { machineFromFixture } from "./machine-helpers";

function run(machine: Machine, ms: number, each?: () => void): void {
  const { cpu } = machine;
  const end = cpu.cycles + ms * 16_000;
  while (cpu.cycles < end) {
    avrInstruction(cpu);
    cpu.tick();
    each?.();
  }
}

const allOutput = (serial: SerialPorts) => serial.takeOutput().map((chunk) => chunk.text).join("");

describe("Utf8StreamDecoder", () => {
  it("decodes characters split across calls", () => {
    const decoder = new Utf8StreamDecoder();
    const bytes = encodeUtf8("ä€😀");
    const pieces = [...bytes].map((byte) => decoder.decode([byte]));

    expect(pieces.join("")).toBe("ä€😀");
    expect(pieces.filter((p) => p !== "")).toEqual(["ä", "€", "😀"]);
  });

  it.each([
    ["a lone continuation byte", [0x80, 0x41], "�A"],
    ["a truncated sequence before ASCII", [0xe2, 0x82, 0x41], "�A"],
    ["an invalid lead byte", [0xff], "�"],
    ["an overlong encoding", [0xc0, 0x80], "�"],
    ["an encoded surrogate", [0xed, 0xa0, 0x80], "�"],
    ["a code point above U+10FFFF", [0xf4, 0x90, 0x80, 0x80], "�"],
  ])("replaces %s with U+FFFD", (_name, bytes, text) => {
    expect(new Utf8StreamDecoder().decode(bytes)).toBe(text);
  });

  it("flushes an unfinished sequence as U+FFFD once", () => {
    const decoder = new Utf8StreamDecoder();
    decoder.decode([0xf0, 0x9f]);

    expect(decoder.flush()).toBe("�");
    expect(decoder.flush()).toBe("");
  });

  it("encodes like the UTF-8 standard and replaces lone surrogates", () => {
    expect([...encodeUtf8("Aä€\u{1f600}")]).toEqual([0x41, 0xc3, 0xa4, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
    expect([...encodeUtf8("\ud800")]).toEqual([0xef, 0xbf, 0xbd]);
  });
});

describe("SerialPorts (plan P1.7)", () => {
  it("delivers UTF-8 output in complete characters, however often it is collected", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const serial = new SerialPorts(machine);
    const chunks: string[] = [];
    run(machine, 40, () => {
      for (const chunk of serial.takeOutput()) chunks.push(chunk.text);
    });

    expect(chunks.join("")).toBe("Grüße: äöü € 😀\r\n");
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((c) => !c.includes("�"))).toBe(true);
  });

  it("reads the frame format the sketch configured", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const serial = new SerialPorts(machine);
    run(machine, 1);

    // Serial.begin(9600) at 16 MHz: U2X, UBRR 207 -> 16e6 / (8 * 208), which avr8js reports as an integer
    expect(serial.frameConfig(0)).toEqual({ baud: Math.floor(16e6 / (8 * 208)), dataBits: 8, parity: "none", stopBits: 1 });
    expect(serial.portIndexes).toEqual([0]);
  });

  it("feeds parseInt() and keeps its 1 s timeout", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const serial = new SerialPorts(machine);
    run(machine, 50);
    allOutput(serial);
    serial.send(0, "42");
    run(machine, 1200);

    // Stream::parseInt waits 1000 ms for a further digit after "42" (two frames ≈ 2 ms).
    const match = /^n=42 after (\d+) ms\r\n$/.exec(allOutput(serial));
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(1000);
    expect(Number(match?.[1])).toBeLessThanOrEqual(1004);
  });

  it("hands the USART one byte per frame time", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const serial = new SerialPorts(machine);
    run(machine, 50);
    const usart = machine.peripherals.usarts[0];
    const pump = usart.onRxComplete;
    const times: number[] = [];
    usart.onRxComplete = () => {
      times.push(machine.cpu.cycles);
      pump?.();
    };
    serial.send(0, "0123456789");
    run(machine, 20);

    const frameCycles = (16e6 * 10) / serial.frameConfig(0).baud; // start + 8 data + stop
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(times).toHaveLength(10);
    for (const gap of gaps) expect(Math.abs(gap - frameCycles)).toBeLessThan(16);
  });

  it("keeps 63 bytes in the core's 64-byte ring buffer and loses the rest, like the board", () => {
    const machine = machineFromFixture("uno", "uno-serial_overflow.hex");
    const serial = new SerialPorts(machine);
    run(machine, 10);
    serial.send(0, "x".repeat(100));
    run(machine, 320);

    expect(allOutput(serial)).toBe("kept 63\r\n");
    expect(serial.pendingBytes(0)).toBe(0);
  });

  it("discards input that arrives before the sketch enables the receiver, like the board, and reports it once", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const discarded: [number, number][] = [];
    const serial = new SerialPorts(machine, (port, bytes) => discarded.push([port, bytes]));
    serial.send(0, "7\n"); // before Serial.begin()
    serial.send(0, "8\n");

    expect(serial.pendingBytes(0)).toBe(0);
    expect(discarded).toEqual([[0, 2]]); // one report for the situation, not one per message or byte
    run(machine, 60);
    expect(allOutput(serial)).not.toContain("n=");
  });

  it("delivers input sent after Serial.begin() unchanged and reports nothing", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const discarded: [number, number][] = [];
    const serial = new SerialPorts(machine, (port, bytes) => discarded.push([port, bytes]));
    run(machine, 60);
    serial.send(0, "7\n");
    run(machine, 60);

    expect(allOutput(serial)).toContain("n=7 after ");
    expect(discarded).toEqual([]);
  });

  it("enforces the input limits of UnoSim", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const serial = new SerialPorts(machine);
    run(machine, 60); // receiver enabled by Serial.begin()
    const block = "x".repeat(SERIAL_INPUT_LIMITS.maxMessageBytes);

    expect(() => serial.send(0, `${block}x`)).toThrow(/exceeds 4096 bytes/);
    for (let i = 0; i < SERIAL_INPUT_LIMITS.maxPendingBytes / block.length; i++) serial.send(0, block);
    expect(() => serial.send(0, "xx")).toThrow(/pending/); // the first byte of the backlog is already in the USART
    expect(() => serial.send(1, "x")).toThrow(/serial port 1 does not exist/);
  });

  it("names a missing USART", () => {
    const machine = machineFromFixture("uno", "uno-serial_probe.hex");
    const broken = { ...machine, peripherals: { ...machine.peripherals, usarts: [] } };

    expect(() => new SerialPorts(broken)).toThrow(/atmega328p has no USART0/);
  });
});
