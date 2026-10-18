import { describe, expect, it } from "vitest";
import { SKIP_CORPUS, shardCases, shardSuite } from "./corpus-suite";

describe("runtime reference corpus: probes", () => {
  it("has cases", () => {
    expect(shardCases("probes").length).toBeGreaterThan(0);
  });

  describe.skipIf(SKIP_CORPUS)("cases", shardSuite("probes"));
});
