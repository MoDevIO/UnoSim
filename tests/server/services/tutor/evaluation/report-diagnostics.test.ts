import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnchorCourseContent } from "../../../../../server/services/tutor/evaluation/anchor-course-content";
import {
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const roleQuestion = "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?";
const feedback = "Deine Antwort ist noch unvollständig.";

function freeScenario(id: string): TutorQualityEvaluationScenario {
  return {
    id,
    corpusId: "test-corpus",
    corpusVersion: 1,
    sketchRef: "inline.ino",
    sketch: "int counter = 3; void setup() { Serial.println(counter); } void loop() {}",
    turns: [{ kind: "dialog", question: "Was speichert counter?", answer: "Eine Zahl.", difficulty: 30 }],
  };
}

function plannerScenario(id: string): TutorQualityEvaluationScenario {
  return {
    ...freeScenario(id),
    courseContent: createAnchorCourseContent("progression-learn"),
    turns: [{ kind: "dialog", question: roleQuestion, answer: "int speichert den Wert von counter.", difficulty: 30 }],
    expected: { learningPhase: "LEARN", phaseAfter: "DEEPEN", answerRating: [3, 5] },
    judge: { facts: ["counter ist eine int-Variable."], criteria: [{ id: "accepts-answer", text: "Das Feedback würdigt die Antwort." }] },
  };
}

const provider: LLMProvider & { generateStructuredResponse(): Promise<{ model: string; result: unknown }> } = {
  async listModels() { return ["fake-model", "fake-judge"]; },
  async generateLearningQuestion() {
    // Rating 1 is outside the [3, 5] band of the planner case.
    return { model: "fake-model", result: { responseStyle: "normal" as const, answerRating: 1 as const, feedback, question: "Welche Beobachtung ist belegt?" } };
  },
  async generateStructuredResponse() {
    return {
      model: "fake-judge",
      result: { criteria: [{ id: "accepts-answer", verdict: "pass", reason: "Das Feedback würdigt die Antwort.", quote: feedback }], criticalIssues: [] },
    };
  },
};

async function runWith(scenarios: readonly TutorQualityEvaluationScenario[]) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-diagnostics-"));
  directories.push(outputDir);
  const result = await runTutorQualityEvaluation({
    scenarios,
    provider,
    providerId: "fake-provider",
    credential: "tutor-secret",
    judgeCredential: "judge-secret",
    requestedModel: "fake-model",
    judgeModel: "fake-judge",
    samples: 2,
    maxCalls: 60,
    outputDir,
    git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    now: () => new Date("2026-10-03T10:00:00.000Z"),
    runSuffix: () => "fixed",
  });
  return {
    result,
    markdown: await readFile(path.join(outputDir, "report.md"), "utf8"),
    json: JSON.parse(await readFile(path.join(outputDir, "report.json"), "utf8")) as Record<string, any>,
  };
}

describe("evaluation report diagnostics (§11.2, R-REP-3)", () => {
  it("records per-turn phase, rating, blocked reason, follow-up provenance and check outcomes in report.json", async () => {
    const { json } = await runWith([plannerScenario("planner-case")]);
    const sample = json.samples[0];

    expect(sample).toMatchObject({ scenarioId: "planner-case", sampleIndex: 0, phaseAfter: "LEARN", stageAStatus: "completed" });
    expect(sample.turns).toHaveLength(1);
    expect(sample.turns[0]).toMatchObject({
      index: 0,
      learningPhase: "LEARN",
      answerRating: 1,
      followUpSource: "planner",
    });
    expect(sample.turns[0]).not.toHaveProperty("progressionBlockedReason");
    const outcomes = Object.fromEntries(sample.turns[0].checks.map((check: { name: string; outcome: string }) => [check.name, check.outcome]));
    expect(outcomes).toMatchObject({
      "expected-learning-phase": "pass",
      "expected-answer-rating": "fail",
      "expected-phase-after": "not-applicable",
    });
    expect(sample.violations).toEqual([
      expect.objectContaining({ source: "final-tutor", code: "answer-rating-out-of-band", turnIndex: 0 }),
    ]);
    expect(sample.turns[0].violations).toEqual(sample.violations);
    expect(sample.durationMs).toBeTypeOf("number");
    expect(sample.providerCalls).toMatchObject({ judgeCalls: 1 });
    expect(json.totalDurationMs).toBeTypeOf("number");
  });

  it("reports the follow-up provenance of a provider-owned question", async () => {
    const { json } = await runWith([freeScenario("free-case")]);

    expect(json.samples[0].turns[0].followUpSource).toBe("provider");
  });

  it("shows the corpus ID and version at run level in report.json and report.md (§11.2)", async () => {
    const { json, markdown } = await runWith([plannerScenario("planner-case")]);

    expect(json.manifest).toMatchObject({ corpusId: "test-corpus", corpusVersion: 1 });
    expect(markdown).toContain("Corpus: test-corpus v1");
  });

  it("shows the corpus ID and version even when the run stops before any sample", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-diagnostics-"));
    directories.push(outputDir);
    await runTutorQualityEvaluation({
      scenarios: [freeScenario("a-case")],
      provider,
      providerId: "fake-provider",
      requestedModel: "fake-model",
      samples: 1,
      maxCalls: 5,
      outputDir,
      git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    });
    const json = JSON.parse(await readFile(path.join(outputDir, "report.json"), "utf8")) as Record<string, any>;

    expect(json).toMatchObject({ runStatus: "not-run", reason: "missing-credential", manifest: { corpusId: "test-corpus", corpusVersion: 1 } });
  });

  it("renders the same diagnostics in report.md", async () => {
    const { markdown } = await runWith([plannerScenario("planner-case")]);

    expect(markdown).toContain("#### planner-case / sample 0");
    expect(markdown).toContain("phase after: LEARN");
    expect(markdown).toContain("turn 0: phase LEARN, rating 1, blocked none, follow-up planner");
    expect(markdown).toContain("[fail] expected-answer-rating");
    expect(markdown).toContain("[n/a] expected-phase-after (rating-out-of-band)");
    expect(markdown).toContain("violation final-tutor / answer-rating-out-of-band");
    expect(markdown).toContain("judge: evaluated");
    expect(markdown).toMatch(/Duration: \d+ ms/);
    expect(markdown).not.toMatch(/tutor-secret|judge-secret/);
  });

  it("carries the quality verdict and the findings behind it in report.json (§12)", async () => {
    // Rating 1 lies outside the band in both samples: a repeated rating finding (k(2) = 2).
    const { json, result } = await runWith([plannerScenario("planner-case"), freeScenario("free-case")]);

    expect(json.qualityVerdict).toEqual({
      verdict: "fail",
      ruleRevision: "tutor-quality-verdict-v1",
      samplesPerCase: 2,
      repeatThreshold: 2,
      judgeConfigured: true,
      findings: [
        { scenarioId: "planner-case", class: "rating-out-of-band", key: "final-tutor/answer-rating-out-of-band", samples: [0, 1], effect: "fail" },
      ],
    });
    expect(result.report.qualityVerdict).toEqual(json.qualityVerdict);
  });

  it("reports a run that stops before any sample as inconclusive", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-diagnostics-"));
    directories.push(outputDir);
    const { report } = await runTutorQualityEvaluation({
      scenarios: [freeScenario("a-case")],
      provider,
      providerId: "fake-provider",
      requestedModel: "fake-model",
      samples: 3,
      maxCalls: 5,
      outputDir,
      git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    });
    const markdown = await readFile(path.join(outputDir, "report.md"), "utf8");

    expect(report.qualityVerdict).toMatchObject({
      verdict: "inconclusive",
      judgeConfigured: false,
      findings: [{ class: "run-not-completed", key: "run/not-run/missing-credential", samples: [], effect: "inconclusive" }],
    });
    expect(markdown).toContain("- [inconclusive] run: run-not-completed run/not-run/missing-credential");
  });

  it("renders the quality verdict before the diagnostics in report.md", async () => {
    const { markdown } = await runWith([plannerScenario("planner-case"), freeScenario("free-case")]);

    expect(markdown).toContain([
      "## Quality verdict",
      "",
      "Verdict: fail",
      "Rule: tutor-quality-verdict-v1; samples per case 2; repeat threshold 2; Judge configured",
      "- [fail] planner-case: rating-out-of-band final-tutor/answer-rating-out-of-band (samples 0, 1)",
      "",
      "## Deterministic diagnostics",
    ].join("\n"));
  });

  it("states a pass verdict without findings in report.md", async () => {
    const { markdown, json } = await runWith([freeScenario("free-case")]);

    expect(json.qualityVerdict).toMatchObject({ verdict: "pass", findings: [] });
    expect(markdown).toContain("Verdict: pass\nRule: tutor-quality-verdict-v1; samples per case 2; repeat threshold 2; Judge configured\n- no findings\n");
  });

  it("orders report.md by case, sample, turn and check so that two runs compare with a text diff", async () => {
    const forward = await runWith([freeScenario("b-case"), plannerScenario("a-case")]);
    const reversed = await runWith([plannerScenario("a-case"), freeScenario("b-case")]);

    expect(forward.markdown).toBe(reversed.markdown);
    const order = [...forward.markdown.matchAll(/^#### (\S+) \/ sample (\d+)$/gm)].map(([, id, sample]) => `${id}/${sample}`);
    expect(order).toEqual(["a-case/0", "a-case/1", "b-case/0", "b-case/1"]);
    // Within every turn the checks are ordered by name.
    const turnBlocks = forward.markdown.split(/^- turn /m).slice(1);
    expect(turnBlocks.length).toBeGreaterThan(0);
    for (const block of turnBlocks) {
      const names = block.split("\n").filter((line) => /^\s+- \[(pass|fail|n\/a)\] /.test(line)).map((line) => line.replace(/^\s+- \[[^\]]+\] /, "").split(" ")[0]!);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual([...names].sort());
    }
    expect(forward.json.samples.map((sample: { scenarioId: string; sampleIndex: number }) => `${sample.scenarioId}/${sample.sampleIndex}`))
      .toEqual(["a-case/0", "a-case/1", "b-case/0", "b-case/1"]);
  });
});
