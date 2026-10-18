import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImageError, readElfSymbols } from "../src/index";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

describe("readElfSymbols", () => {
  it("reads function and data symbols like avr-nm", () => {
    const symbols = readElfSymbols(fixture("uno-blink-nolto.elf"));

    expect(symbols.get("digitalWrite")).toMatchObject({ value: 0x12a, kind: "function" });
    expect(symbols.get("pinMode")).toMatchObject({ value: 0x1c2, kind: "function" });
    expect(symbols.get("__bss_end")?.value).toBe(0x800109);
  });

  it("finds no I/O function symbols in the LTO build", () => {
    const symbols = readElfSymbols(fixture("uno-blink.elf"));

    expect(symbols.has("digitalWrite")).toBe(false);
    expect(symbols.get("_end")?.value).toBe(0x800109);
  });

  it.each([
    ["a non-ELF file", new Uint8Array(64), /not an ELF file/],
    ["a too short file", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), /not an ELF file/],
  ])("rejects %s", (_name, bytes, message) => {
    expect(() => readElfSymbols(bytes)).toThrow(message);
  });

  it("rejects 64-bit, big-endian and non-AVR files", () => {
    const elf = fixture("uno-blink.elf");
    const variant = (offset: number, value: number) => {
      const copy = elf.slice();
      copy[offset] = value;
      return copy;
    };

    expect(() => readElfSymbols(variant(4, 2))).toThrow(/32-bit little-endian/);
    expect(() => readElfSymbols(variant(5, 2))).toThrow(/32-bit little-endian/);
    expect(() => readElfSymbols(variant(18, 62))).toThrow(/not for AVR/);
  });

  it("rejects a section table outside the file", () => {
    const elf = fixture("uno-blink.elf").slice();
    new DataView(elf.buffer).setUint32(32, elf.length, true);

    expect(() => readElfSymbols(elf)).toThrow(ImageError);
  });

  it("accepts a view into a larger buffer", () => {
    const elf = fixture("uno-blink-nolto.elf");
    const padded = new Uint8Array(elf.length + 16);
    padded.set(elf, 16);

    expect(readElfSymbols(padded.subarray(16)).get("pinMode")?.value).toBe(0x1c2);
  });
});
