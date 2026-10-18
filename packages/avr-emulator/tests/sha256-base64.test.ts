import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64, ImageError, sha256Hex } from "../src/index";

const text = (s: string) => new TextEncoder().encode(s);

describe("sha256Hex", () => {
  // FIPS 180-4 / NIST example vectors.
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ])("hashes %j", (input, digest) => {
    expect(sha256Hex(text(input))).toBe(digest);
  });

  it("hashes one million 'a' (multi-block input)", () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it.each([55, 56, 63, 64, 65])("pads a %i-byte message across the block boundary", (length) => {
    // Reference values from `head -c N /dev/zero | shasum -a 256`.
    const expected: Record<number, string> = {
      55: "02779466cdec163811d078815c633f21901413081449002f24aa3e80f0b88ef7",
      56: "d4817aa5497628e7c77e6b606107042bbba3130888c5f47a375e6179be789fbb",
      63: "c7723fa1e0127975e49e62e753db53924c1bd84b8ac1ac08df78d09270f3d971",
      64: "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
      65: "98ce42deef51d40269d542f5314bef2c7468d401ad5d85168bfab4c0108f75f7",
    };
    expect(sha256Hex(new Uint8Array(length))).toBe(expected[length]);
  });
});

describe("Base64", () => {
  it.each([
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foobar", "Zm9vYmFy"],
  ])("round-trips %j as RFC 4648 %j", (plain, encoded) => {
    expect(encodeBase64(text(plain))).toBe(encoded);
    expect(new TextDecoder().decode(decodeBase64(encoded))).toBe(plain);
  });

  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

    expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
  });

  it.each(["abc", "ab=c", "a*bc", "abc==="])("rejects %j", (input) => {
    expect(() => decodeBase64(input)).toThrow(ImageError);
  });
});
