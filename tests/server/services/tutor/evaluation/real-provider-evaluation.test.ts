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
      difficulty: 30,
    }],
    ...overrides,
  };
}

function providerFor(result: unknown, returnedModel = "fake-model"): LLMProvider {
  return {
    async listModels() {
      return ["fake-model", "judge-model"];
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
  it("judges only completed cases and reports the structured call separately", async () => {
    let judgeInputs = "";
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async generateStructuredResponse(request: { readonly userPrompt: string }) {
        judgeInputs = request.userPrompt;
        return {
          model: "judge-model",
          result: {
            criteria: [{ id: "correct-answer", verdict: "pass", reason: "Feedback confirms the answer.", quote: "Correct, counter starts at three." }],
            criticalIssues: [],
          },
        };
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: {
        facts: ["counter starts at three"],
        criteria: [{ id: "correct-answer", text: "Feedback accepts the right value." }],
      } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
    }));

    expect(result.semanticEvaluations).toMatchObject([{ evaluation: { status: "evaluated", model: "judge-model" } }]);
    expect(result.report.providerCalls).toMatchObject({ judgeCalls: 1, total: 4 });
    expect(judgeInputs).not.toMatch(/fake-model|judge-model|secret/);
    expect(result.transcripts[0]?.metadata.providerCalls).not.toHaveProperty("judgeCalls");
  });

  it("accepts a resolved Judge model ID and reports it beside the requested alias", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-judge-model-alias-"));
    temporaryDirectories.push(outputDir);
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async listModels() { return ["fake-model", "openai-gpt5.5"]; },
      async generateStructuredResponse() {
        return {
          model: "gpt-5.5-2026-04-24",
          result: {
            criteria: [{
              id: "correct-answer",
              verdict: "pass",
              reason: "Feedback confirms the answer.",
              quote: "Correct, counter starts at three.",
            }],
            criticalIssues: [],
          },
        };
      },
    };

    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: {
        facts: ["counter starts at three"],
        criteria: [{ id: "correct-answer", text: "Feedback accepts the right value." }],
      } })],
      judgeModel: "openai-gpt5.5",
      judgeCredential: "judge-secret",
      outputDir,
    }));
    const report = JSON.parse(await readFile(path.join(outputDir, "report.json"), "utf8"));

    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({
      status: "evaluated",
      model: "gpt-5.5-2026-04-24",
      criteria: [{ id: "correct-answer", verdict: "pass" }],
    });
    expect(report.manifest.judgeModel).toEqual({
      requested: "openai-gpt5.5",
      returned: ["gpt-5.5-2026-04-24"],
    });
  });

  it("fails closed when a Judge response omits its returned model identity", async () => {
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async listModels() { return ["fake-model", "openai-gpt5.5"]; },
      async generateStructuredResponse() {
        return {
          model: undefined,
          result: {
            criteria: [{
              id: "correct-answer",
              verdict: "pass",
              reason: "Feedback confirms the answer.",
              quote: "Correct, counter starts at three.",
            }],
            criticalIssues: [],
          },
        };
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: {
        facts: ["counter starts at three"],
        criteria: [{ id: "correct-answer", text: "Feedback accepts the right value." }],
      } })],
      judgeModel: "openai-gpt5.5",
      judgeCredential: "judge-secret",
    }));

    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({
      status: "judge-invalid",
      reason: "returned-model-missing",
    });
  });

  it("requires the fixed Judge alias in the existing model-list preflight", async () => {
    let generationCalls = 0;
    let judgeCalls = 0;
    const provider = {
      ...providerFor({ question: "What changes counter?" }),
      async listModels() { return ["fake-model"]; },
      async generateLearningQuestion() {
        generationCalls += 1;
        return { model: "fake-model", result: { responseStyle: "normal" as const, answerRating: 5 as const, feedback: "Correct, counter starts at three.", question: "What changes counter?" } };
      },
      async generateStructuredResponse() {
        judgeCalls += 1;
        return { model: "gpt-5.5-2026-04-24", result: {} };
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: {
        facts: ["counter starts at three"],
        criteria: [{ id: "correct-answer", text: "Feedback accepts the right value." }],
      } })],
      judgeModel: "openai-gpt5.5",
      judgeCredential: "judge-secret",
    }));

    expect(result.report).toMatchObject({ runStatus: "invalid", reason: "judge-model-unavailable" });
    expect(result.report.providerCalls).toMatchObject({ total: 1, modelListCalls: 1, generationCalls: 0, judgeCalls: 0 });
    expect(generationCalls).toBe(0);
    expect(judgeCalls).toBe(0);
  });

  it("reports an exhausted shared budget instead of aborting before a Judge call", async () => {
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async generateStructuredResponse() {
        throw new Error("must not reach Judge provider");
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: {
        facts: ["counter starts at three"],
        criteria: [{ id: "correct-answer", text: "Feedback accepts the right value." }],
      } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
      maxCalls: 3,
    }));

    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({ status: "budget-exhausted" });
    expect(result.report.providerCalls).toMatchObject({ total: 3, judgeCalls: 0 });
    expect(result.report.runStatus).toBe("completed");
  });

  it("does not count a Judge call when the injected provider lacks structured capability", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 5,
      feedback: "Correct, counter starts at three.",
      question: "What changes counter?",
    }), {
      scenarios: [scenario({ judge: { facts: ["fact"], criteria: [{ id: "correct", text: "Correct." }] } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
    }));

    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({ status: "judge-error", reason: "provider-unavailable" });
    expect(result.report.providerCalls).toMatchObject({ total: 3, judgeCalls: 0 });
  });

  it("does not call the Judge when the Tutor turn fails", async () => {
    let judgeCalls = 0;
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async generateLearningQuestion() { throw new TutorProviderError("provider-timeout"); },
      async generateStructuredResponse() { judgeCalls += 1; return { model: "judge-model", result: {} }; },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: { facts: ["fact"], criteria: [{ id: "correct", text: "Correct." }] } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
    }));

    expect(judgeCalls).toBe(0);
    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({ status: "not-evaluated", reason: "tutor-turn-not-completed" });
  });

  it("records a Judge timeout as a typed error with no retry", async () => {
    let judgeCalls = 0;
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async generateStructuredResponse() {
        judgeCalls += 1;
        throw new TutorProviderError("provider-timeout");
      },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: { facts: ["fact"], criteria: [{ id: "correct", text: "Correct." }] } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
    }));

    expect(judgeCalls).toBe(1);
    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({
      status: "judge-error",
      reason: "provider-timeout",
      promptRevision: expect.any(String),
      promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      durationMs: expect.any(Number),
    });
  });

  it("treats a provider's invalid structured JSON as a fail-closed Judge result", async () => {
    const provider = {
      ...providerFor({
        responseStyle: "normal",
        answerRating: 5,
        feedback: "Correct, counter starts at three.",
        question: "What changes counter?",
      }),
      async generateStructuredResponse() { throw new TutorProviderError("invalid-response"); },
    };
    const result = await runTutorQualityEvaluation(options(provider, {
      scenarios: [scenario({ judge: { facts: ["fact"], criteria: [{ id: "correct", text: "Correct." }] } })],
      judgeModel: "judge-model",
      judgeCredential: "judge-secret",
    }));

    expect(result.semanticEvaluations[0]?.evaluation).toMatchObject({ status: "judge-invalid", reason: "provider-invalid-response" });
  });

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

  it("accepts and preserves a resolved Tutor model ID as sample provenance", async () => {
    const result = await runTutorQualityEvaluation(options(providerFor({
      responseStyle: "normal",
      answerRating: 4,
      question: "Welche Beobachtung ist belegt?",
    }, "other-model")));
    const transcript = result.transcripts[0]!;

    expect(transcript.executionStatus).toBe("completed");
    expect(transcript.turns[0]?.returnedModel).toBe("other-model");
    expect(transcript.deterministicChecks.find(({ name }) => name === "returned-model-present")?.passed).toBe(true);
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
    expect(files).toEqual(["report.json", "report.md"]);
    expect(reportText).not.toContain("super-secret-value");
  });

  it("does not run without the Judge credential when a Judge model is configured (R-PYR-2)", async () => {
    let calls = 0;
    const provider = providerFor({ question: "Welche Beobachtung ist belegt?" });
    const counted: LLMProvider = {
      async listModels(credential) { calls += 1; return provider.listModels(credential); },
      async generateLearningQuestion(request, credential) { calls += 1; return provider.generateLearningQuestion(request, credential); },
    };
    const result = await runTutorQualityEvaluation(options(counted, {
      scenarios: [scenario({ judge: { facts: ["counter ist eine Variable."], criteria: [{ id: "names-counter", text: "Das Feedback nennt counter." }] } })],
      judgeModel: "judge-model",
      judgeCredential: undefined,
    }));

    expect(result.report).toMatchObject({ runStatus: "not-run", reason: "missing-judge-credential", providerCalls: { total: 0 } });
    expect(result.transcripts).toEqual([]);
    expect(calls).toBe(0);
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
  describe("expected answer rating and phaseAfter", () => {
    const roleQuestion = "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?";
    function ratingScenario(expected: NonNullable<TutorQualityEvaluationScenario["expected"]>) {
      return scenario({
        id: "rating-band",
        sketch: "int counter = 3; void setup() { Serial.println(counter); } void loop() {}",
        courseContent: createAnchorCourseContent("progression-learn"),
        turns: [{ kind: "dialog", question: roleQuestion, answer: "int speichert den Wert von counter.", difficulty: 30 }],
        expected,
      });
    }
    function ratedProvider(rating: number) {
      return providerFor({ responseStyle: "normal", answerRating: rating, question: "Welche Beobachtung ist belegt?" });
    }

    it("passes the band check and phaseAfter when the rating is inside the band", async () => {
      const result = await runTutorQualityEvaluation(options(ratedProvider(4), {
        scenarios: [ratingScenario({ learningPhase: "LEARN", phaseAfter: "DEEPEN", answerRating: [3, 5] })],
      }));
      const transcript = result.transcripts[0]!;

      expect(transcript.invariantViolations).toEqual([]);
      expect(transcript.deterministicChecks).toContainEqual(expect.objectContaining({ name: "expected-answer-rating", passed: true }));
      expect(transcript.deterministicChecks).toContainEqual(expect.objectContaining({ name: "expected-phase-after", passed: true }));
    });

    it("reports a rating outside the band as a rating failure and phaseAfter as not applicable", async () => {
      const result = await runTutorQualityEvaluation(options(ratedProvider(1), {
        scenarios: [ratingScenario({ learningPhase: "LEARN", phaseAfter: "DEEPEN", answerRating: [3, 5] })],
      }));
      const transcript = result.transcripts[0]!;

      expect(transcript.invariantViolations).toEqual([
        expect.objectContaining({ code: "answer-rating-out-of-band", source: "final-tutor", turnIndex: 0 }),
      ]);
      const phaseAfter = transcript.deterministicChecks.find(({ name }) => name === "expected-phase-after");
      expect(phaseAfter).toMatchObject({ outcome: "not-applicable", reason: "rating-out-of-band" });
      expect(phaseAfter?.passed).not.toBe(true);
    });

    it("reports a phaseAfter mismatch as a progression failure only when the rating is inside the band", async () => {
      const result = await runTutorQualityEvaluation(options(ratedProvider(4), {
        scenarios: [ratingScenario({ learningPhase: "LEARN", phaseAfter: "EXPAND", answerRating: [3, 5] })],
      }));

      expect(result.transcripts[0]!.invariantViolations).toEqual([
        expect.objectContaining({ code: "phase-after-mismatch", source: "state" }),
      ]);
    });

    it("keeps checking phaseAfter when no rating band is declared", async () => {
      const result = await runTutorQualityEvaluation(options(ratedProvider(4), {
        scenarios: [ratingScenario({ learningPhase: "LEARN", phaseAfter: "EXPAND" })],
      }));

      expect(result.transcripts[0]!.invariantViolations.map(({ code }) => code)).toEqual(["phase-after-mismatch"]);
    });
  });
});
