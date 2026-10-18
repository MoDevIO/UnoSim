import { beforeAll, describe, expect, it } from "vitest";
import { type CaseRun, type CorpusCase, diffOutput, expectedOf, loadCorpus, runCase } from "./corpus-helpers";

/** A case emulates up to several seconds of sketch time. */
const CASE_TIMEOUT_MS = 120_000;

/**
 * The corpus runs in several test files so that Vitest spreads it over its
 * workers (a case costs up to a second of emulation, ten times more under
 * coverage). Every case belongs to exactly one shard; `corpus-helpers.test.ts`
 * checks that.
 */
export const SHARDS: Readonly<Record<string, (testCase: CorpusCase) => boolean>> = {
  probes: (testCase) => testCase.group === "probes",
  "it01-it03": (testCase) => testCase.group === "examples-v3.0.0" && /^it0[1-3]-/.test(testCase.id),
  "it04-it05": (testCase) => testCase.group === "examples-v3.0.0" && /^it0[45]-/.test(testCase.id),
  "it06-it11": (testCase) => testCase.group === "examples-v3.0.0" && /^it(0[678]|11)-/.test(testCase.id),
};

/**
 * Plan 7.4, P1.14: every case of the shard runs headless from its checked-in
 * HEX and must reproduce the expected output and the state checks. The class
 * (`provenance`) says what a pass proves: `hardware` the match with the board,
 * `derived` the match with an independent derivation, `regression` only that
 * nothing changed.
 */
export function describeShard(name: string): void {
  const cases = loadCorpus().filter(SHARDS[name]);

  // The coverage pass (`npm run test:coverage`) skips the corpus: it adds no coverage of `src/`
  // and costs minutes under V8 instrumentation. `npm run test:unit` always runs it.
  describe.skipIf(process.env.UNOSIM_SKIP_CORPUS === "1")(`runtime reference corpus: ${name}`, () => {
    it("has cases", () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    describe.each(cases.map((testCase) => [`${testCase.group}/${testCase.id} (${testCase.provenance})`, testCase] as const))("%s", (_name, testCase) => {
      let run: CaseRun;
      beforeAll(() => {
        run = runCase(testCase);
      }, CASE_TIMEOUT_MS);

      it("reproduces the expected output", () => {
        expect(diffOutput(expectedOf(testCase), run.output, testCase.tolerances)).toEqual([]);
      });

      it("satisfies its state checks", () => {
        const failed = run.result.checks.filter((check) => !check.ok).map((check) => `${JSON.stringify(check.expectation)} actual ${check.actual}`);
        expect(failed).toEqual([]);
        expect(run.result.checks).toHaveLength(testCase.expectState.length);
      });

      it("runs without diagnostics", () => {
        expect(run.result.diagnostics).toEqual([]);
      });
    });
  });
}
