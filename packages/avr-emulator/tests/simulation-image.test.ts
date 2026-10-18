import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CPU, avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import {
  ImageError,
  SIMULATION_IMAGE_FORMAT_VERSION,
  type SimulationImage,
  avr8jsSramParameter,
  buildSimulationImage,
  loadSimulationImage,
} from "../src/index";
import { EOF_RECORD, record } from "./hex-helpers";

const fixtureText = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const fixtureBytes = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const BLINK_SHA256 = "08ca27a87a1a5a0ecaf805be862333766f2fba5328f086089d123b4144cf776f";

describe("buildSimulationImage", () => {
  it("builds the transport form from HEX and ELF", () => {
    const image = buildSimulationImage({ board: "uno", hex: fixtureText("uno-blink.hex"), elf: fixtureBytes("uno-blink.elf") });

    expect(image).toMatchObject({ formatVersion: SIMULATION_IMAGE_FORMAT_VERSION, board: "uno", flashBytes: 932, sha256: BLINK_SHA256 });
    expect(image.flashBase64).toHaveLength(Math.ceil(932 / 3) * 4);
    expect(image.symbols).toEqual({ functions: {}, data: { __bss_end: 0x109, _end: 0x109 } });
  });

  it("keeps I/O entry points when the ELF has them", () => {
    const image = buildSimulationImage({ board: "uno", hex: fixtureText("uno-blink.hex"), elf: fixtureBytes("uno-blink-nolto.elf") });

    expect(image.symbols.functions).toEqual({ digitalWrite: 0x12a, pinMode: 0x1c2 });
  });

  it("works without ELF and uses the MCU flash size of the board", () => {
    const hex = [record(4, 0, [0, 1]), record(0, 0, [1, 2]), EOF_RECORD].join("\n"); // 0x10000

    expect(buildSimulationImage({ board: "mega2560", hex }).flashBytes).toBe(0x10002);
    expect(() => buildSimulationImage({ board: "uno", hex })).toThrow(/exceeds the flash size of 32768/);
    expect(buildSimulationImage({ board: "nano", hex: fixtureText("uno-blink.hex") }).symbols).toEqual({ functions: {}, data: {} });
  });

  it("rejects an empty HEX file", () => {
    expect(() => buildSimulationImage({ board: "attiny85", hex: EOF_RECORD })).toThrow(/no data/);
  });
});

describe("loadSimulationImage", () => {
  const image = buildSimulationImage({ board: "uno", hex: fixtureText("uno-blink.hex"), elf: fixtureBytes("uno-blink-nolto.elf") });

  it("round-trips through JSON and expands to the whole flash, erased bytes 0xFF", () => {
    const loaded = loadSimulationImage(JSON.parse(JSON.stringify(image)));

    expect(loaded).toMatchObject({ board: "uno", mcu: "atmega328p", flashBytes: 932, sha256: BLINK_SHA256 });
    expect(loaded.progMem).toHaveLength(16 * 1024);
    expect(loaded.progMem[0]).toBe(0x940c); // jmp, little endian
    expect(loaded.progMem[(32 * 1024) / 2 - 1]).toBe(0xffff);
    expect(loaded.symbols.functions.pinMode).toBe(0x1c2);
  });

  it("gives avr8js a program that runs", () => {
    const loaded = loadSimulationImage(image);
    const cpu = new CPU(loaded.progMem, avr8jsSramParameter({ sramStart: 0x100, sramBytes: 2048 }));
    for (let i = 0; i < 10_000; i++) avrInstruction(cpu);

    expect(cpu.pc).toBeLessThan(932 / 2);
  });

  const tamper = (patch: Partial<Record<keyof SimulationImage, unknown>>) => ({ ...image, ...patch });

  it.each([
    ["null", null, /must be an object/],
    ["another format", tamper({ formatVersion: 2 }), /unsupported image format 2/],
    ["an unknown board", tamper({ board: "esp32" }), /unknown board esp32/],
    ["missing flash data", tamper({ flashBase64: undefined }), /flashBase64 and sha256/],
    ["a wrong length", tamper({ flashBytes: 931 }), /flashBytes/],
    ["a wrong hash", tamper({ sha256: "0".repeat(64) }), /SHA-256/],
    ["invalid Base64", tamper({ flashBase64: "####" }), /Base64/],
    ["an image larger than the flash", tamper({ board: "attiny85", flashBase64: "A".repeat(11_000) }), /exceeds the flash size of attiny85/],
  ])("rejects %s", (_name, input, message) => {
    expect(() => loadSimulationImage(input)).toThrow(ImageError);
    expect(() => loadSimulationImage(input)).toThrow(message);
  });

  it("drops malformed or out-of-range symbols instead of trusting them", () => {
    const loaded = loadSimulationImage(tamper({
      symbols: { functions: { pinMode: -2, digitalWrite: 1.5, analogRead: 0x10000, digitalRead: 4, foo: 1 }, data: "x" },
    }));

    expect(loaded.symbols).toEqual({ functions: { digitalRead: 4 }, data: {} });
  });
});
