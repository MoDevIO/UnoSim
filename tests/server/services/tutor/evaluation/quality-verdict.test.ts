import { describe, expect, it } from "vitest";
import {
  computeTutorQualityVerdict,
  repeatThreshold,
  TUTOR_QUALITY_VERDICT_RULE_REVISION,
  type TutorQualityVerdictInput,
  type TutorQualityVerdictSample,
  type TutorQualityVerdictSemanticRecord,
} from "../../../../../server/services/tutor/evaluation/quality-verdict";

// Synthetic, anonymized fixtures shaped after the baseline and rerun data
// (docs/tutor-quality-baseline-2026-10-03.md, docs/tutor-quality-remediation-rerun-2026-10-03.md).

function sample(scenarioId: string, sampleIndex: number, overrides: Partial<TutorQualityVerdictSample> = {}): TutorQualityVerdictSample {
  return { scenarioId, sampleIndex, executionStatus: "completed", violations: [], ...overrides };
}

function judged(
  scenarioId: string,
  sampleIndex: number,
  criteria: Readonly<Record<string, "pass" | "fail" | "unclear">>,
  criticalIssues: readonly string[] = [],
): TutorQualityVerdictSemanticRecord {
  return {
    scenarioId,
    sampleIndex,
    evaluation: {
      status: "evaluated",
      criteria: Object.entries(criteria).map(([id, verdict]) => ({ id, verdict, reason: "synthetic reason" })),
      criticalIssues: criticalIssues.map((code) => ({ code, reason: "synthetic reason", quote: "synthetic quote" })),
    },
  };
}

function cleanCase(scenarioId: string, samples = 3): { samples: TutorQualityVerdictSample[]; records: TutorQualityVerdictSemanticRecord[] } {
  return {
    samples: Array.from({ length: samples }, (_, index) => sample(scenarioId, index)),
    records: Array.from({ length: samples }, (_, index) => judged(scenarioId, index, { "case-criterion": "pass" })),
  };
}

function input(overrides: Partial<TutorQualityVerdictInput> = {}): TutorQualityVerdictInput {
  const clean = cleanCase("case-a");
  return {
    runStatus: "completed",
    samplesPerCase: 3,
    judgeConfigured: true,
    samples: clean.samples,
    semanticEvaluations: clean.records,
    ...overrides,
  };
}

describe("repeat threshold k(n) (R-VER-4)", () => {
  it("is a strict majority and never a single sample", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(repeatThreshold)).toEqual([2, 2, 2, 3, 3, 4, 11]);
  });
});

describe("Tutor Quality verdict (R-VER-1..7)", () => {
  it("is pass without findings and records rule revision, n, k, and Judge configuration", () => {
    expect(computeTutorQualityVerdict(input())).toEqual({
      verdict: "pass",
      ruleRevision: TUTOR_QUALITY_VERDICT_RULE_REVISION,
      samplesPerCase: 3,
      repeatThreshold: 2,
      judgeConfigured: true,
      findings: [],
    });
  });

  it("is warn for an isolated Judge criterion fail", () => {
    const verdict = computeTutorQualityVerdict(input({
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "fail" }),
        judged("case-a", 1, { "case-criterion": "pass" }),
        judged("case-a", 2, { "case-criterion": "pass" }),
      ],
    }));

    expect(verdict.verdict).toBe("warn");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "judge-criterion", key: "criterion/case-criterion", samples: [0], effect: "warn" },
    ]);
  });

  it("fails on a deterministic application violation in a single sample", () => {
    const verdict = computeTutorQualityVerdict(input({
      samples: [
        sample("case-a", 0),
        sample("case-a", 1, { violations: [{ source: "state", code: "progression-blocked-reason-mismatch", turnIndex: 1 }] }),
        sample("case-a", 2),
      ],
    }));

    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "product-violation", key: "state/progression-blocked-reason-mismatch", samples: [1], effect: "fail" },
    ]);
  });

  it("treats every final-tutor violation except the rating band as a product violation", () => {
    const verdict = computeTutorQualityVerdict(input({
      samples: [
        sample("case-a", 0, { violations: [{ source: "final-tutor", code: "phase-mismatch" }] }),
        sample("case-a", 1),
        sample("case-a", 2),
      ],
    }));

    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings[0]).toMatchObject({ class: "product-violation", key: "final-tutor/phase-mismatch", effect: "fail" });
  });

  it("fails on a repeated rating-band violation and warns on an isolated one", () => {
    const outOfBand = { source: "final-tutor" as const, code: "answer-rating-out-of-band", turnIndex: 1 };
    const repeated = computeTutorQualityVerdict(input({
      samples: [sample("case-a", 0, { violations: [outOfBand] }), sample("case-a", 1), sample("case-a", 2, { violations: [outOfBand] })],
    }));
    const isolated = computeTutorQualityVerdict(input({
      samples: [sample("case-a", 0), sample("case-a", 1), sample("case-a", 2, { violations: [outOfBand] })],
    }));

    expect(repeated.verdict).toBe("fail");
    expect(repeated.findings).toEqual([
      { scenarioId: "case-a", class: "rating-out-of-band", key: "final-tutor/answer-rating-out-of-band", samples: [0, 2], effect: "fail" },
    ]);
    expect(isolated.verdict).toBe("warn");
    expect(isolated.findings[0]).toMatchObject({ class: "rating-out-of-band", samples: [2], effect: "warn" });
  });

  it("counts raw provider violations as LLM-dependent findings per code", () => {
    const verdict = computeTutorQualityVerdict(input({
      samples: [
        sample("case-a", 0, { violations: [{ source: "raw-provider", code: "complete-solution", turnIndex: 0 }, { source: "raw-provider", code: "complete-solution", turnIndex: 1 }] }),
        sample("case-a", 1, { violations: [{ source: "raw-provider", code: "question-repeat", turnIndex: 1 }] }),
        sample("case-a", 2),
      ],
    }));

    // Two turns of one sample count once; different codes never add up.
    expect(verdict.verdict).toBe("warn");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "raw-provider-violation", key: "raw-provider/complete-solution", samples: [0], effect: "warn" },
      { scenarioId: "case-a", class: "raw-provider-violation", key: "raw-provider/question-repeat", samples: [1], effect: "warn" },
    ]);
  });

  it("fails on a Judge criterion that fails in a majority of samples", () => {
    const verdict = computeTutorQualityVerdict(input({
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "fail" }),
        judged("case-a", 1, { "case-criterion": "fail" }),
        judged("case-a", 2, { "case-criterion": "pass" }),
      ],
    }));

    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "judge-criterion", key: "criterion/case-criterion", samples: [0, 1], effect: "fail" },
    ]);
  });

  it("fails on a repeated critical issue and counts duplicate codes in one record once", () => {
    const verdict = computeTutorQualityVerdict(input({
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "pass" }, ["correct-answer-rejected", "correct-answer-rejected"]),
        judged("case-a", 1, { "case-criterion": "pass" }),
        judged("case-a", 2, { "case-criterion": "pass" }, ["correct-answer-rejected"]),
      ],
    }));

    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "critical-issue", key: "critical-issue/correct-answer-rejected", samples: [0, 2], effect: "fail" },
    ]);
  });

  it("never adds independent isolated findings of different cases or keys into a fail", () => {
    // Baseline pattern: one critical issue in each of four cases, plus isolated criterion fails.
    const cases = ["case-a", "case-b", "case-c", "case-d"];
    const verdict = computeTutorQualityVerdict(input({
      samples: cases.flatMap((id) => cleanCase(id).samples),
      semanticEvaluations: cases.flatMap((id, caseIndex) => [0, 1, 2].map((index) => (
        index === caseIndex % 3
          ? judged(id, index, { "case-criterion": "fail", "other-criterion": "pass" }, [caseIndex === 3 ? "complete-solution" : "correct-answer-rejected"])
          : judged(id, index, { "case-criterion": "pass", "other-criterion": index === 2 ? "fail" : "pass" })
      ))),
    }));

    expect(verdict.verdict).toBe("warn");
    expect(verdict.findings.every(({ effect }) => effect === "warn")).toBe(true);
    expect(verdict.findings.every(({ samples }) => samples.length === 1)).toBe(true);
  });

  it("is inconclusive for a technical failure and keeps the Judge record's own reason", () => {
    const verdict = computeTutorQualityVerdict(input({
      samples: [
        sample("case-a", 0),
        sample("case-a", 1, { executionStatus: "technical-failure", technicalErrorKind: "provider-timeout" }),
        sample("case-a", 2),
      ],
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "pass" }),
        { scenarioId: "case-a", sampleIndex: 1, evaluation: { status: "not-evaluated", reason: "tutor-turn-not-completed" } },
        judged("case-a", 2, { "case-criterion": "pass" }),
      ],
    }));

    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.findings).toEqual([
      { scenarioId: "case-a", class: "sample-not-completed", key: "execution/technical-failure/provider-timeout", samples: [1], effect: "inconclusive" },
      { scenarioId: "case-a", class: "judge-not-evaluated", key: "judge/not-evaluated/tutor-turn-not-completed", samples: [1], effect: "inconclusive" },
    ]);
  });

  it("is inconclusive for an invalid sample and its scenario violation", () => {
    const verdict = computeTutorQualityVerdict(input({
      judgeConfigured: false,
      semanticEvaluations: [],
      samples: [
        sample("case-a", 0, {
          executionStatus: "invalid",
          invalidReason: "preceding-question-mismatch",
          violations: [{ source: "scenario", code: "preceding-question-mismatch", turnIndex: 1 }],
        }),
        sample("case-a", 1),
        sample("case-a", 2),
      ],
    }));

    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.findings.map(({ class: findingClass, key }) => [findingClass, key])).toEqual([
      ["scenario-violation", "scenario/preceding-question-mismatch"],
      ["sample-not-completed", "execution/invalid/preceding-question-mismatch"],
    ]);
  });

  it("is inconclusive when a Judge status is not evaluated", () => {
    for (const status of ["judge-invalid", "judge-error", "budget-exhausted"] as const) {
      const verdict = computeTutorQualityVerdict(input({
        semanticEvaluations: [
          judged("case-a", 0, { "case-criterion": "pass" }),
          { scenarioId: "case-a", sampleIndex: 1, evaluation: { status, reason: "synthetic" } },
          judged("case-a", 2, { "case-criterion": "pass" }),
        ],
      }));

      expect(verdict.verdict).toBe("inconclusive");
      expect(verdict.findings).toEqual([
        { scenarioId: "case-a", class: "judge-not-evaluated", key: `judge/${status}/synthetic`, samples: [1], effect: "inconclusive" },
      ]);
    }
  });

  it("is inconclusive for a run that did not complete", () => {
    for (const [runStatus, runReason] of [["not-run", "missing-credential"], ["invalid", "dirty-relevant-worktree"], ["technical-failure", "provider-timeout"]] as const) {
      const verdict = computeTutorQualityVerdict(input({ runStatus, runReason, samples: [], semanticEvaluations: [] }));

      expect(verdict.verdict).toBe("inconclusive");
      expect(verdict.findings).toEqual([
        { class: "run-not-completed", key: `run/${runStatus}/${runReason}`, samples: [], effect: "inconclusive" },
      ]);
    }
  });

  it("treats isolated unclear verdicts as warn and repeated ones as inconclusive (R-VER-5)", () => {
    const isolated = computeTutorQualityVerdict(input({
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "unclear" }),
        judged("case-a", 1, { "case-criterion": "pass" }),
        judged("case-a", 2, { "case-criterion": "pass" }),
      ],
    }));
    const repeated = computeTutorQualityVerdict(input({
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "unclear" }),
        judged("case-a", 1, { "case-criterion": "unclear" }),
        judged("case-a", 2, { "case-criterion": "fail" }),
      ],
    }));

    expect(isolated.verdict).toBe("warn");
    expect(isolated.findings).toEqual([
      { scenarioId: "case-a", class: "unclear-criterion", key: "criterion-unclear/case-criterion", samples: [0], effect: "warn" },
    ]);
    expect(repeated.verdict).toBe("inconclusive");
    expect(repeated.findings.map(({ key, effect }) => [key, effect])).toEqual([
      ["criterion/case-criterion", "warn"],
      ["criterion-unclear/case-criterion", "inconclusive"],
    ]);
  });

  it("ranks fail above inconclusive and inconclusive above warn (R-VER-6)", () => {
    const technical = sample("case-b", 0, { executionStatus: "technical-failure", technicalErrorKind: "provider-timeout" });
    const failAndInconclusive = computeTutorQualityVerdict(input({
      samples: [...cleanCase("case-a").samples, technical],
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "fail" }),
        judged("case-a", 1, { "case-criterion": "fail" }),
        judged("case-a", 2, { "case-criterion": "pass" }),
      ],
    }));
    const warnAndInconclusive = computeTutorQualityVerdict(input({
      samples: [...cleanCase("case-a").samples, technical],
      semanticEvaluations: [judged("case-a", 0, { "case-criterion": "fail" })],
    }));

    expect(failAndInconclusive.verdict).toBe("fail");
    expect(warnAndInconclusive.verdict).toBe("inconclusive");
  });

  it("establishes a repeated finding from the planned samples even if another sample failed technically", () => {
    const verdict = computeTutorQualityVerdict(input({
      samples: [sample("case-a", 0), sample("case-a", 1), sample("case-a", 2, { executionStatus: "technical-failure", technicalErrorKind: "provider-timeout" })],
      semanticEvaluations: [
        judged("case-a", 0, { "case-criterion": "fail" }),
        judged("case-a", 1, { "case-criterion": "fail" }),
        { scenarioId: "case-a", sampleIndex: 2, evaluation: { status: "not-evaluated", reason: "tutor-turn-not-completed" } },
      ],
    }));

    expect(verdict.verdict).toBe("fail");
  });

  it("can only warn on LLM-dependent findings of a single-sample run", () => {
    const verdict = computeTutorQualityVerdict(input({
      samplesPerCase: 1,
      samples: [sample("case-a", 0, { violations: [{ source: "final-tutor", code: "answer-rating-out-of-band" }] })],
      semanticEvaluations: [judged("case-a", 0, { "case-criterion": "fail" }, ["correct-answer-rejected"])],
    }));

    expect(verdict).toMatchObject({ verdict: "warn", samplesPerCase: 1, repeatThreshold: 2 });
  });

  it("judges an execution-only run on deterministic findings and records that no Judge was configured", () => {
    const verdict = computeTutorQualityVerdict(input({ judgeConfigured: false, semanticEvaluations: [] }));

    expect(verdict).toMatchObject({ verdict: "pass", judgeConfigured: false, findings: [] });
  });

  it("orders findings deterministically by case, class (SSOT table order), and key", () => {
    const outOfBand = { source: "final-tutor" as const, code: "answer-rating-out-of-band" };
    const shuffled = computeTutorQualityVerdict(input({
      samples: [sample("case-b", 0, { violations: [outOfBand] }), sample("case-a", 2, { violations: [outOfBand] }), sample("case-a", 0)],
      semanticEvaluations: [judged("case-b", 0, { zeta: "fail", alpha: "fail" }), judged("case-a", 0, { beta: "fail" })],
    }));

    expect(shuffled.findings.map(({ scenarioId, key }) => `${scenarioId} ${key}`)).toEqual([
      "case-a final-tutor/answer-rating-out-of-band",
      "case-a criterion/beta",
      "case-b final-tutor/answer-rating-out-of-band",
      "case-b criterion/alpha",
      "case-b criterion/zeta",
    ]);
  });
});
