import { describe, expect, it } from "vitest";
import { SKIP_CORPUS, shardCases, shardSuite } from "./corpus-suite";

describe("runtime reference corpus: examples on the Mega 2560", () => {
  it("has cases", () => {
    expect(shardCases("mega").length).toBeGreaterThan(0);
  });

  describe.skipIf(SKIP_CORPUS)("cases", shardSuite("mega"));
});
