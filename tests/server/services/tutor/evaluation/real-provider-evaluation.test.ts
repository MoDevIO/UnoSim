import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnchorCourseContent } from "../../../../../server/services/tutor/evaluation/anchor-course-content";
import {
  CountingProvider,
  MAX_TUTOR_QUALITY_CALLS,
  MAX_TUTOR_QUALITY_SAMPLES,
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import { sha256 } from "../../../../../server/services/tutor/evaluation/canonical";
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
  it("counts structured provider calls in the same maximum-call budget", async () => {
    let structuredCallCount = 0;
    const provider = {
      async listModels() { return ["fake-model"]; },
      async generateLearningQuestion() { return { model: "fake-model", result: {} as never }; },
      async generateStructuredResponse() {
        structuredCallCount += 1;
        return { model: "judge-model", result: { verdict: "pass" } };
      },
    };
    const countingProvider = new CountingProvider(provider, 2);
    const request = {
      model: "judge-model",
      systemPrompt: "judge system",
      userPrompt: "judge user",
      temperature: 0,
    };

    await expect(countingProvider.generateLearningQuestion({ model: "tutor-model", systemPrompt: "tutor system", userPrompt: "tutor user" }, "credential")).resolves.toEqual({
      model: "fake-model",
      result: {},
    });
    await expect(countingProvider.generateStructuredResponse(request, "credential")).resolves.toEqual({
      model: "judge-model",
      result: { verdict: "pass" },
    });
    await expect(countingProvider.generateStructuredResponse(request, "credential")).rejects.toMatchObject({
      name: "EvaluationBudgetExceeded",
    });
    expect(structuredCallCount).toBe(1);
    expect(countingProvider.counts).toEqual({ total: 2, modelListCalls: 0, generationCalls: 1, judgeCalls: 1 });
  });

  it("keeps Stage-A identity independent of structured Judge calls", async () => {
    let structuredCalls = 0;
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        question: "Welche Beobachtung ist im Sketch belegt?",
      }),
      async generateStructuredResponse() {
        structuredCalls += 1;
        return { model: "judge-model", result: { verdict: "pass" } };
      },
    };
    const first = await runTutorQualityEvaluation(options(provider));
    await provider.generateStructuredResponse();
    await provider.generateStructuredResponse();
    const second = await runTutorQualityEvaluation(options(provider));

    expect(structuredCalls).toBe(2);
    expect(first.transcripts[0]?.evaluationIdentity).toBe(second.transcripts[0]?.evaluationIdentity);
    expect(first.transcripts[0]?.metadata.providerCalls).toEqual(second.transcripts[0]?.metadata.providerCalls);
  });

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

  it("records digests of the prompts sent to the provider for every transcript turn", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 4,
      question: "Welche Beobachtung ist im Sketch belegt?",
    })));
    const request = result.transcripts[0]?.turns[0]?.providerRequest;

    expect(request).toMatchObject({
      systemPromptDigest: sha256(request?.systemPrompt ?? ""),
      userPromptDigest: sha256(request?.userPrompt ?? ""),
    });
  });

  it("records the existing bounded heuristic for a near-repeat", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 3,
      question: "Welche Rolle hat counter im Sketch?",
    })));
    const repeat = result.transcripts[0]?.invariantViolations.find(({ code }) => code === "question-repeat");

    expect(repeat?.details).toBe("stage1-heuristic");
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

  it("marks a missing returned model invalid without leaking or throwing", async () => {
    const result = await runTutorQualityEvaluation(options({
      async listModels() {
        return ["fake-model"];
      },
      async generateLearningQuestion() {
        return {
          model: undefined as never,
          result: { question: "Welche Beobachtung ist belegt?", responseStyle: "normal" },
        };
      },
    }));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("invalid");
    expect(transcript.invalidReason).toBe("returned-model-missing");
    expect(transcript.turns[0]).not.toHaveProperty("returnedModel");
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

  it("supports an injected artifact writer without touching the repository", async () => {
    let writtenReport: string | undefined;
    let writtenTranscriptCount = -1;
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 4,
      question: "Welche Beobachtung ist belegt?",
    }), {
      artifactWriter: async (report, transcripts) => {
        writtenReport = report.runId;
        writtenTranscriptCount = transcripts.length;
      },
    }));

    expect(writtenReport).toBe(result.report.runId);
    expect(writtenTranscriptCount).toBe(1);
  });

  it("redacts a credential echoed by a fake provider from every transcript field", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 4,
      question: "super-secret-value?",
      feedback: "super-secret-value",
    })));
    const transcriptText = JSON.stringify(result.transcripts[0]);

    expect(transcriptText).not.toContain("super-secret-value");
    expect(transcriptText).toContain("[REDACTED]");
  });

  it("redacts credentials from scripted learner input in every transcript turn", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 4,
      question: "Welche Beobachtung ist belegt?",
    }), {
      scenarios: [scenario({
        turns: [{
          kind: "dialog",
          question: "Welche Beobachtung ist belegt?",
          answer: "super-secret-value",
          bindsToQuestion: "Welche Beobachtung ist belegt?",
        }],
      })],
    }));
    const transcriptText = JSON.stringify(result.transcripts[0]);

    expect(transcriptText).not.toContain("super-secret-value");
    expect(transcriptText).toContain("[REDACTED]");
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

  it("records malformed provider output as a schema violation and technical failure", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: "not-a-rating",
    })));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("technical-failure");
    expect(transcript.technicalError?.kind).toBe("invalid-response");
    expect(transcript.invariantViolations.map(({ code }) => code)).toContain("schema-invalid");
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

    const unboundedSamples = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }), {
      samples: MAX_TUTOR_QUALITY_SAMPLES + 1,
    }));
    expect(unboundedSamples.report).toMatchObject({ runStatus: "invalid", reason: "sample-count-exceeds-limit" });
    expect(unboundedSamples.report.providerCalls.total).toBe(0);

    const unboundedCalls = await runTutorQualityEvaluation(options(providerFor({ question: "Welche Beobachtung ist belegt?" }), {
      maxCalls: MAX_TUTOR_QUALITY_CALLS + 1,
    }));
    expect(unboundedCalls.report).toMatchObject({ runStatus: "invalid", reason: "call-budget-exceeds-limit" });
    expect(unboundedCalls.report.providerCalls.total).toBe(0);
  });

  it("does not apply a learner answer to an arbitrary preceding real-model question", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      question: "Welche neue Beobachtung ist belegt?",
      answerRating: 4,
    }), {
      scenarios: [scenario({
        id: "bound-continuation",
        turns: [
          { kind: "initial", difficulty: 20 },
          {
            kind: "dialog",
            question: "Welche deklarierte Frage soll gelten?",
            answer: "Eine Antwort auf die deklarierte Frage.",
            bindsToQuestion: "Welche deklarierte Frage soll gelten?",
            continuationOf: 0,
            difficulty: 20,
          },
        ],
      })],
    }));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("invalid");
    expect(transcript.invalidReason).toBe("preceding-question-mismatch");
    expect(transcript.turns).toHaveLength(1);
  });
});
