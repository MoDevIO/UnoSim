import { describe, expect, it } from "vitest";
import { diffOutput, expectedOf, loadCorpus, runCase } from "./corpus-helpers";

/**
 * Plan 7.4, P1.14: every case of the reference corpus runs headless from its
 * checked-in HEX and must reproduce the expected output and the state checks.
 * The class (`provenance`) says what a pass proves: `hardware` the match with
 * the board, `derived` the match with an independent derivation, `regression`
 * only that nothing changed.
 */
const corpus = loadCorpus();

describe("runtime reference corpus", () => {
  it("contains cases", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  describe.each(corpus.map((testCase) => [`${testCase.group}/${testCase.id} (${testCase.provenance})`, testCase] as const))("%s", (_name, testCase) => {
    const { result, output } = runCase(testCase);

    it("reproduces the expected output", () => {
      expect(diffOutput(expectedOf(testCase), output, testCase.tolerances)).toEqual([]);
    });

    it("satisfies its state checks", () => {
      const failed = result.checks.filter((check) => !check.ok).map((check) => `${JSON.stringify(check.expectation)} actual ${check.actual}`);
      expect(failed).toEqual([]);
      expect(result.checks).toHaveLength(testCase.expectState.length);
    });

    it("runs without diagnostics", () => {
      expect(result.diagnostics).toEqual([]);
    });
  });
});
