import { describe, expect, it } from "vitest";
import { parseEnvInt, validatePoolBounds } from "../../server/config";

describe("central configuration validation", () => {
  it("rejects malformed, fractional and out-of-range integers", () => {
    expect(() => parseEnvInt("PORT", "abc", 3000, { min: 1, max: 65535 })).toThrow(/expected an integer/);
    expect(() => parseEnvInt("PORT", "3.5", 3000, { min: 1, max: 65535 })).toThrow(/expected an integer/);
    expect(() => parseEnvInt("PORT", "70000", 3000, { min: 1, max: 65535 })).toThrow(/between/);
  });

  it("preserves defaults and accepts valid integer values", () => {
    expect(parseEnvInt("PORT", undefined, 3000, { min: 1, max: 65535 })).toBe(3000);
    expect(parseEnvInt("PORT", "8080", 3000, { min: 1, max: 65535 })).toBe(8080);
  });

  it("rejects an inverted sandbox pool range", () => {
    expect(() => validatePoolBounds(5, 2)).toThrow(/must not exceed/);
    expect(() => validatePoolBounds(2, 5)).not.toThrow();
  });
});
