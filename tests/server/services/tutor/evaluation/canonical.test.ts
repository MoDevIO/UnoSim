import { describe, expect, it } from "vitest";
import { canonicalDigest, canonicalJson } from "../../../../../server/services/tutor/evaluation/canonical";

describe("Tutor Quality canonical values", () => {
  it("serializes object keys in UTF-8 byte order before hashing", () => {
    const value = { z: 1, "ä": 2, a: 3 };

    expect(canonicalJson(value)).toBe('{"a":3,"z":1,"ä":2}');
    expect(canonicalDigest(value)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves array order without mutating the value", () => {
    const value = { turns: ["first", "second"] };
    const before = JSON.stringify(value);

    expect(canonicalDigest(value)).not.toBe(canonicalDigest({ turns: [...value.turns].reverse() }));
    expect(JSON.stringify(value)).toBe(before);
  });
});
