import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnchorCourseContent } from "../../../../../server/services/tutor/evaluation/anchor-course-content";
import {
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import { TutorProviderError, type LLMProvider } from "../../../../../server/services/tutor/llm-provider";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function scenario(overrides: Partial<TutorQualityEvaluationScenario> = {}): TutorQualityEvaluationScenario {
  return {
    id: "repeat-case",
    corpusId: "test-corpus",
    corpusVersion: 1,
    sketchRef: "inline.ino",
    sketch: "int counter = 3; void setup() { Serial.begin(9600); } void loop() {}",
    courseContent: undefined,
    turns: [{
      kind: "dialog",
      question: "Welche Rolle spielt counter im Sketch?",
      answer: "counter speichert einen ganzzahligen Wert.",
      bindsToQuestion: "Welche Rolle spielt counter im Sketch?",
      difficulty: 30,
    }],
    ...overrides,
  };
}

function providerFor(result: unknown, returnedModel = "fake-model"): LLMProvider {
  return {
    async listModels() {
      return ["fake-model"];
    },
    async generateLearningQuestion() {
      return { model: returnedModel, result: result as never };
    },
  };
}

function options(provider: LLMProvider, overrides: Partial<Parameters<typeof runTutorQualityEvaluation>[0]> = {}) {
  return {
    scenarios: [scenario()],
    provider,
    providerId: "fake-provider",
    credential: "super-secret-value",
    requestedModel: "fake-model",
    samples: 1,
    maxCalls: 10,
    git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    ...overrides,
  };
}

describe("real-provider Tutor Quality evaluation runner", () => {
  it("captures the raw repeated question and preserves the repaired final response", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 5,
      question: "Welche Rolle spielt counter im Sketch?",
    })));

    const transcript = result.transcripts[0]!;
    expect(transcript.executionStatus).toBe("completed");
    expect(transcript.invariantViolations.map(({ code }) => code)).toContain("question-repeat");
    expect(transcript.turns[0]?.rawProviderResult).toMatchObject({ question: "Welche Rolle spielt counter im Sketch?" });
    expect(transcript.turns[0]?.finalTutorResult?.question).not.toBe("Welche Rolle spielt counter im Sketch?");
    expect(result.report.providerCalls).toMatchObject({ total: 3, modelListCalls: 2, generationCalls: 1 });
  });

  it("separates provider failure from state mutation and does not commit state", async () => {
    const content = createAnchorCourseContent("progression-learn");
    const provider: LLMProvider = {
      async listModels() {
        return ["fake-model"];
      },
      async generateLearningQuestion() {
        throw new TutorProviderError("provider-timeout");
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ id: "timeout", courseContent: content })],
    }));

    const transcript = result.transcripts[0]!;
    expect(transcript.executionStatus).toBe("technical-failure");
    expect(transcript.technicalError?.kind).toBe("provider-timeout");
    expect(transcript.deterministicChecks.find(({ name }) => name === "state-unchanged-after-failure")?.passed).toBe(true);
    expect(transcript.stateBefore).toEqual(transcript.stateAfter);
  });

  it("marks a returned-model mismatch invalid without treating it as quality", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }, "other-model")));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("invalid");
    expect(transcript.invalidReason).toBe("returned-model-mismatch");
    expect(transcript.invariantViolations).toHaveLength(0);
  });

  it("counts every provider call against the budget and stops before generation", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }), { maxCalls: 2 }));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("technical-failure");
    expect(transcript.technicalError?.kind).toBe("call-budget-exhausted");
    expect(result.report.providerCalls).toMatchObject({ total: 2, modelListCalls: 2, generationCalls: 0 });
  });

  it("writes a run-level missing-credential report without sample transcripts or secrets", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-stage2a-"));
    temporaryDirectories.push(outputDir);
    const result = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }), {
      credential: undefined,
      outputDir,
    }));
    const files = await readdir(outputDir);
    const reportText = await readFile(path.join(outputDir, "report.json"), "utf8");

    expect(result.report.runStatus).toBe("not-run");
    expect(result.report.reason).toBe("missing-credential");
    expect(result.report.providerCalls.total).toBe(0);
    expect(files).toEqual(["report.json"]);
    expect(reportText).not.toContain("super-secret-value");
  });

  it("records raw complete-solution and schema violations separately from technical failure", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      question: "void setup() {} void loop() {}",
    })));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("technical-failure");
    expect(transcript.technicalError?.kind).toBe("invalid-response");
    expect(transcript.invariantViolations.map(({ code }) => code)).toContain("complete-solution");
  });

  it("does not trust provider-supplied planning metadata", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      question: "Welche Beobachtung ist belegt?",
      topicId: "forged-topic",
      questionId: "forged-question",
      learningPhase: "EXPAND",
      contentRevision: "f".repeat(40),
    }), {
      scenarios: [scenario({
        id: "forged-metadata",
        sketch: "int counter = 3; Serial.println(counter);",
        courseContent: createAnchorCourseContent("variables"),
        turns: [{ kind: "initial", difficulty: 20 }],
      })],
    }));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("completed");
    expect(transcript.turns[0]?.rawProviderResult).toMatchObject({ topicId: "forged-topic", learningPhase: "EXPAND" });
    expect(transcript.turns[0]?.finalTutorResult).toMatchObject({
      topicId: "variables-and-serial",
      learningPhase: "LEARN",
    });
  });

  it("starts every sample from a fresh progression-state clone", async () => {
    const content = createAnchorCourseContent("progression-learn");
    const provider = providerFor({
      responseStyle: "normal",
      answerRating: 5,
      question: "Welche Folgefrage ist als Nächstes sinnvoll?",
    });
    const result = await runTutorQualityEvaluation(options(provider, {
      samples: 2,
      scenarios: [scenario({
        id: "fresh-state",
        sketch: "int counter = 3; Serial.println(counter);",
        courseContent: content,
        turns: [{
          kind: "dialog",
          question: "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?",
          answer: "int speichert den ganzzahligen Wert von counter.",
          bindsToQuestion: "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?",
          difficulty: 30,
        }],
      })],
    }));

    expect(result.transcripts).toHaveLength(2);
    expect(result.transcripts.map(({ stateBefore }) => stateBefore?.phase)).toEqual([undefined, undefined]);
  });

  it("rejects dirty or unavailable-model preflight without generation calls", async () => {
    const dirty = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }), {
      git: { sha: "a".repeat(40), trackedClean: false, relevantUntrackedClean: true },
    }));
    expect(dirty.report).toMatchObject({ runStatus: "invalid", reason: "dirty-relevant-worktree" });
    expect(dirty.report.providerCalls.total).toBe(0);

    const unavailable = await runTutorQualityEvaluation(options({
      async listModels() {
        return ["different-model"];
      },
      async generateLearningQuestion() {
        throw new Error("must not be called");
      },
    }));
    expect(unavailable.report).toMatchObject({ runStatus: "invalid", reason: "model-unavailable" });
    expect(unavailable.report.providerCalls).toMatchObject({ total: 1, generationCalls: 0 });
  });
});
