import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImageError, parseIntelHex } from "../src/index";
import { EOF_RECORD, record } from "./hex-helpers";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("parseIntelHex", () => {
  it("reads the arduino-cli HEX like avr-objcopy (932 bytes)", () => {
    const image = parseIntelHex(fixture("uno-blink.hex"), 32 * 1024);

    expect(image.bytes).toHaveLength(932);
    expect([...image.bytes.subarray(0, 4)]).toEqual([0x0c, 0x94, 0x5c, 0x00]);
    expect(image.recordTypes).toEqual([0, 1]);
  });

  it("applies extended segment (02) and extended linear (04) addresses", () => {
    const text = [
      record(0, 0x0000, [1, 2]),
      record(2, 0, [0x10, 0x00]), // segment 0x1000 -> base 0x10000
      record(0, 0x0004, [3]),
      record(4, 0, [0x00, 0x02]), // linear 0x0002 -> base 0x20000
      record(0, 0x0001, [4, 5]),
      EOF_RECORD,
    ].join("\n");

    const image = parseIntelHex(text, 256 * 1024);

    expect(image.bytes).toHaveLength(0x20003);
    expect(image.bytes[0x10004]).toBe(3);
    expect([...image.bytes.subarray(0x20001, 0x20003)]).toEqual([4, 5]);
    expect(image.recordTypes).toEqual([0, 1, 2, 4]);
  });

  it("fills gaps with 0xFF like erased flash", () => {
    const image = parseIntelHex([record(0, 0, [0]), record(0, 4, [1]), EOF_RECORD].join("\n"), 64);

    expect([...image.bytes]).toEqual([0, 0xff, 0xff, 0xff, 1]);
  });

  it("ignores start-address records (03, 05) and lines after the EOF record", () => {
    const text = [record(0, 0, [7]), record(3, 0, [0, 0, 0, 0]), record(5, 0, [0, 0, 0, 0]), EOF_RECORD, "garbage"].join("\r\n");

    expect([...parseIntelHex(text, 16).bytes]).toEqual([7]);
  });

  it.each([
    ["a wrong checksum", ":0100000007F9\n:00000001FF", /checksum/],
    ["a missing colon", "0100000007F8\n:00000001FF", /not an Intel HEX record/],
    ["a byte count that does not match", ":0200000007F7\n:00000001FF", /length/],
    ["an unknown record type", `${record(6, 0, [])}\n${EOF_RECORD}`, /unknown record type 6/],
    ["a missing EOF record", record(0, 0, [1]), /end-of-file/],
    ["a short address record", `${record(4, 0, [1])}\n${EOF_RECORD}`, /2 data bytes/],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseIntelHex(text, 64)).toThrow(ImageError);
    expect(() => parseIntelHex(text, 64)).toThrow(message);
  });

  it("rejects data beyond the flash size with the line number", () => {
    const text = [record(0, 0, [1]), record(0, 0x7fff, [1, 2]), EOF_RECORD].join("\n");

    expect(() => parseIntelHex(text, 0x8000)).toThrow(/line 2: .*exceeds the flash size of 32768 bytes/);
  });
});
