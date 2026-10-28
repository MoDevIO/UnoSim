import { describe, expect, it } from "vitest";
import { SKIP_CORPUS, shardCases, shardSuite } from "./corpus-suite";

describe("runtime reference corpus: it04-it05", () => {
  it("has cases", () => {
    expect(shardCases("it04-it05").length).toBeGreaterThan(0);
  });

  describe.skipIf(SKIP_CORPUS)("cases", shardSuite("it04-it05"));
});
