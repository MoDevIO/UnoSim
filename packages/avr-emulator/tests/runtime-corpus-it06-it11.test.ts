import { describe, expect, it } from "vitest";
import { SKIP_CORPUS, shardCases, shardSuite } from "./corpus-suite";

describe("runtime reference corpus: it06-it11", () => {
  it("has cases", () => {
    expect(shardCases("it06-it11").length).toBeGreaterThan(0);
  });

  describe.skipIf(SKIP_CORPUS)("cases", shardSuite("it06-it11"));
});
