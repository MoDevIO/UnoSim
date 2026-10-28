import { describe, expect, it } from "vitest";
import { SKIP_CORPUS, shardCases, shardSuite } from "./corpus-suite";

describe("runtime reference corpus: examples on the Nano", () => {
  it("has cases", () => {
    expect(shardCases("nano").length).toBeGreaterThan(0);
  });

  describe.skipIf(SKIP_CORPUS)("cases", shardSuite("nano"));
});
