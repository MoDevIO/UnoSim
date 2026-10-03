import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "../../../../../server/config";
import {
  loadTutorQualityEvaluationScenarios,
  isTutorQualityRelevantUntrackedPath,
  parseTutorQualityCliArgs,
  readTutorQualityGitState,
  runTutorQualityCli,
  runTutorQualityCliMain,
  TUTOR_QUALITY_EXIT_CODES,
  tutorQualityExitCode,
} from "../../../../../scripts/tutor-quality-real-provider-eval";
import {
  MAX_TUTOR_QUALITY_CALLS,
  MAX_TUTOR_QUALITY_SAMPLES,
  runTutorQualityEvaluation,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import { computeTutorQualityVerdict } from "../../../../../server/services/tutor/evaluation/quality-verdict";
import { TutorProviderError, type LLMProvider } from "../../../../../server/services/tutor/llm-provider";

// The fake provider rates every answer with the lower bound of the case's
// expected.answerRating band (5 when the case declares none); it never inspects
// prompt content.
function fakeRatingFor(scenario: { readonly expected?: { readonly answerRating?: readonly [number, number] } }): 1 | 2 | 3 | 4 | 5 {
  return (scenario.expected?.answerRating?.[0] ?? 5) as 1 | 2 | 3 | 4 | 5;
}

describe("Tutor Quality real-provider CLI contract", () => {
  it("requires a fixed model and accepts only a credential environment-variable name", () => {
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "auto"])).toThrow();
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--api-key", "secret"])).toThrow();

    expect(parseTutorQualityCliArgs([
      "--output-dir", "/tmp/tq",
      "--model", "pilot-model",
      "--samples", "2",
      "--max-calls", "12",
      "--credential-env", "TEST_TUTOR_CREDENTIAL",
    ])).toMatchObject({
      model: "pilot-model",
      samples: 2,
      maxCalls: 12,
      credentialEnv: "TEST_TUTOR_CREDENTIAL",
      outputDir: "/tmp/tq",
    });
  });

  it("rejects malformed numeric limits and credential values", () => {
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--samples", "0"])).toThrow();
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--credential-env", "not-a-value"])).toThrow();
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--samples", String(MAX_TUTOR_QUALITY_SAMPLES + 1)])).toThrow(/exceeds maximum/);
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--max-calls", String(MAX_TUTOR_QUALITY_CALLS + 1)])).toThrow(/exceeds maximum/);
    expect(parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--samples", String(MAX_TUTOR_QUALITY_SAMPLES)]).samples).toBe(MAX_TUTOR_QUALITY_SAMPLES);
  });

  it("accepts repeatable case filters and a separately named fixed Judge model", () => {
    expect(parseTutorQualityCliArgs([
      "--output-dir", "/tmp/tq",
      "--model", "pilot-model",
      "--judge-model", "judge-v1",
      "--judge-credential-env", "TEST_JUDGE_CREDENTIAL",
      "--case", "TQ-SEM-001",
      "--case", "learn-to-deepen",
    ])).toMatchObject({
      model: "pilot-model",
      judgeModel: "judge-v1",
      judgeCredentialEnv: "TEST_JUDGE_CREDENTIAL",
      cases: ["TQ-SEM-001", "learn-to-deepen"],
    });
  });

  it("rejects automatic Judge model IDs and credential environment-name reuse", () => {
    expect(() => parseTutorQualityCliArgs([
      "--output-dir", "/tmp/tq", "--model", "pilot-model", "--judge-model", "auto",
    ])).toThrow(/fixed model/i);
    expect(() => parseTutorQualityCliArgs([
      "--output-dir", "/tmp/tq", "--model", "pilot-model", "--judge-model", "judge-v1",
      "--credential-env", "SAME_CREDENTIAL", "--judge-credential-env", "SAME_CREDENTIAL",
    ])).toThrow(/separate/i);
  });

  it("does not treat protected editor SSOT files or the output directory as relevant inputs", () => {
    expect(isTutorQualityRelevantUntrackedPath("ssot/ssot_function_tutor_model_registration.md", ".tutor-quality-output")).toBe(false);
    expect(isTutorQualityRelevantUntrackedPath("evals/tutor-quality/anchor-corpus.yaml", ".tutor-quality-output")).toBe(true);
    expect(isTutorQualityRelevantUntrackedPath(".tutor-quality-output/report.json", ".tutor-quality-output")).toBe(false);
  });

  it("reads the local Git state through a fixed executable location", () => {
    const state = readTutorQualityGitState(process.cwd(), "test-results");
    expect(state.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("materializes and runs the complete versioned anchor corpus with a fake provider", async () => {
    const scenarios = await loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml");
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-cli-test-"));
    try {
      const transcripts = [];
      let generationCalls = 0;
      for (const scenario of scenarios) {
        const rating = fakeRatingFor(scenario);
        const provider: LLMProvider = {
          async listModels() {
            return ["pilot-model"];
          },
          async generateLearningQuestion() {
            return {
              model: "pilot-model",
              result: {
                responseStyle: "normal" as const,
                answerRating: rating,
                question: "Welche konkrete Beobachtung ist im aktuellen Sketch belegt?",
              },
            };
          },
        };
        const result = await runTutorQualityCli([
          "--model", "pilot-model",
          "--samples", "1",
          "--max-calls", "20",
          "--credential-env", "TEST_TUTOR_CREDENTIAL",
          "--case", scenario.id,
          "--output-dir", outputDir,
        ], {
          cwd: process.cwd(),
          environment: { TEST_TUTOR_CREDENTIAL: "secret-value" },
          provider,
          git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
        });
        expect(result.report).toMatchObject({
          runStatus: "completed",
          samplesRequested: 1,
          samplesObserved: 1,
          invalid: 0,
          technicalFailures: 0,
          invariantViolationSamples: 0,
        });
        expect(result.report.qualityVerdict).toMatchObject({ verdict: "pass", findings: [] });
        generationCalls += result.report.providerCalls.generationCalls;
        transcripts.push(...result.transcripts);
      }
      expect(generationCalls).toBeGreaterThan(0);
      expect(transcripts.map(({ scenario }) => scenario.id)).toEqual(scenarios.map(({ id }) => id));
      expect(transcripts.find(({ scenario }) => scenario.id === "TQ-REG-001")?.stateAfter)
        .toEqual(transcripts.find(({ scenario }) => scenario.id === "TQ-REG-001")?.stateBefore);
      const strategyTranscripts = transcripts.filter(({ scenario }) => scenario.id.startsWith("strategy-"));
      expect(strategyTranscripts.length).toBe(scenarios.filter(({ id }) => id.startsWith("strategy-")).length);
      expect(strategyTranscripts.every(({ turns }) => turns.every(({ deterministicChecks }) => deterministicChecks.some(
        ({ name, passed }) => name === "expected-learning-phase" && passed,
      )))).toBe(true);
      expect(transcripts.filter(({ invariantViolations }) => invariantViolations.length > 0).map(({ scenario, invariantViolations }) => ({ id: scenario.id, invariantViolations }))).toEqual([]);
      expect(await readdir(outputDir)).toContain("report.json");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("runs every strategy case through TutorService, the curriculum planner, and the fake Judge", async () => {
    const scenarios = (await loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml"))
      .filter(({ id }) => id.startsWith("strategy-"));
    expect(scenarios.length).toBeGreaterThan(0);
    const outcomes = [];
    let judgeCalls = 0;
    for (const scenario of scenarios) {
      const rating = fakeRatingFor(scenario);
      const provider: LLMProvider & {
        generateStructuredResponse(request: { readonly userPrompt: string }): Promise<{
          readonly model: string;
          readonly result: unknown;
        }>;
      } = {
        async listModels() {
          return ["fake-model", "fake-judge"];
        },
        async generateLearningQuestion() {
          return {
            model: "fake-model",
            result: {
              responseStyle: "normal" as const,
              answerRating: rating,
              feedback: "Deine Antwort lässt sich an der Initialisierung und der seriellen Ausgabe prüfen.",
              question: "Welche konkrete Beobachtung kannst du als Nächstes am Sketch prüfen?",
            },
          };
        },
        async generateStructuredResponse(request) {
          const evidenceJson = request.userPrompt.split("Evaluate this evidence object:\n")[1];
          const evidence = JSON.parse(evidenceJson ?? "{}") as {
            readonly criteria: readonly { readonly id: string }[];
            readonly tutor: { readonly followUpQuestion: string };
          };
          return {
            model: "fake-judge",
            result: {
              criteria: evidence.criteria.map(({ id }) => ({
                id,
                verdict: "pass",
                reason: "The fake Judge inspected the actual Tutor response.",
                quote: evidence.tutor.followUpQuestion,
              })),
              criticalIssues: [],
            },
          };
        },
      };
      const result = await runTutorQualityEvaluation({
        scenarios: [scenario],
        provider,
        providerId: "local-fake-contract-provider",
        requestedModel: "fake-model",
        judgeModel: "fake-judge",
        credential: "fake-tutor-credential",
        judgeCredential: "fake-judge-credential",
        samples: 1,
        maxCalls: 20,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
      });
      judgeCalls += result.report.providerCalls.judgeCalls;
      const transcript = result.transcripts[0]!;
      const turn = transcript.turns.at(-1);
      outcomes.push({
        id: scenario.id,
        phases: transcript.turns.map(({ finalTutorResult }) => finalTutorResult?.learningPhase),
        answerRating: turn?.finalTutorResult?.answerRating,
        phaseAfter: transcript.stateAfter?.phase,
        blocked: turn?.finalTutorResult?.progressionBlockedReason ?? transcript.stateAfter?.progressionBlockedReason,
        // The served follow-up carries a planner-owned question ID (a test statement, not report provenance).
        plannerOwnedQuestion: typeof turn?.finalTutorResult?.questionId === "string",
        violations: transcript.invariantViolations,
        judge: result.semanticEvaluations[0]?.evaluation.status,
      });
    }

    expect(outcomes).toEqual(scenarios.map((scenario) => {
      const expected = scenario.expected!;
      return {
        id: scenario.id,
        phases: scenario.turns.map(() => expected.learningPhase),
        answerRating: fakeRatingFor(scenario),
        phaseAfter: expected.phaseAfter,
        blocked: undefined,
        plannerOwnedQuestion: true,
        violations: [],
        judge: "evaluated",
      };
    }));
    expect(judgeCalls).toBe(scenarios.length);
  });

  it("uses the centrally validated Tutor timeout instead of an injected environment value", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-cli-timeout-"));
    const provider: LLMProvider = {
      async listModels() {
        return ["pilot-model"];
      },
      async generateLearningQuestion() {
        return {
          model: "pilot-model",
          result: { question: "Welche Beobachtung ist im Sketch belegt?", responseStyle: "normal" },
        };
      },
    };
    try {
      const result = await runTutorQualityCli([
        "--model", "pilot-model",
        "--output-dir", outputDir,
        "--credential-env", "TEST_TUTOR_CREDENTIAL",
      ], {
        cwd: process.cwd(),
        environment: {
          TEST_TUTOR_CREDENTIAL: "secret-value",
          UNOSIM_LLM_TIMEOUT_MS: "9000",
        },
        provider,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
      });

      expect(result.transcripts[0]?.metadata.timeoutMs).toBe(config.tutor.timeoutMs);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("filters cases, calls a fake Judge, and writes secret-free JSON and Markdown reports", async () => {
    let judgePrompt = "";
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-cli-judge-"));
    const provider = {
      async listModels() { return ["pilot-model", "judge-model"]; },
      async generateLearningQuestion() {
        return {
          model: "pilot-model",
          result: {
            responseStyle: "normal" as const,
            answerRating: 5 as const,
            feedback: "Deine Antwort ist fachlich korrekt.",
            question: "Was bewirkt INPUT_PULLUP?",
          },
        };
      },
      async generateStructuredResponse(request: { readonly userPrompt: string }) {
        judgePrompt = request.userPrompt;
        const input = JSON.parse(request.userPrompt.split("\n").at(-1) ?? "{}") as {
          criteria: readonly { readonly id: string }[];
          tutor: { readonly feedback: string };
        };
        return {
          model: "judge-model",
          result: {
            criteria: input.criteria.map(({ id }) => ({
              id,
              verdict: "pass",
              reason: "judge-secret: the Tutor response accepts the learner's answer.",
              quote: input.tutor.feedback,
            })),
            criticalIssues: [],
          },
        };
      },
    };
    try {
      const result = await runTutorQualityCli([
        "--model", "pilot-model",
        "--judge-model", "judge-model",
        "--credential-env", "TEST_TUTOR_CREDENTIAL",
        "--judge-credential-env", "TEST_JUDGE_CREDENTIAL",
        "--case", "TQ-SEM-001",
        "--output-dir", outputDir,
      ], {
        cwd: process.cwd(),
        environment: {
          TEST_TUTOR_CREDENTIAL: "tutor-secret",
          TEST_JUDGE_CREDENTIAL: "judge-secret",
        },
        provider,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
      });
      const reportJson = await readFile(path.join(outputDir, "report.json"), "utf8");
      const reportMarkdown = await readFile(path.join(outputDir, "report.md"), "utf8");

      expect(result.transcripts.map(({ scenario }) => scenario.id)).toEqual(["TQ-SEM-001"]);
      expect(result.semanticEvaluations[0]?.evaluation.status).toBe("evaluated");
      expect(judgePrompt).not.toMatch(/pilot-model|judge-model|tutor-secret|judge-secret/);
      expect(JSON.parse(reportJson)).toMatchObject({
        samples: [{
          scenarioId: "TQ-SEM-001",
          stageAStatus: "completed",
          semanticEvaluation: { status: "evaluated" },
          providerCalls: { judgeCalls: 1 },
        }],
        manifest: {
          gitSha: "a".repeat(40),
          corpusFileDigests: [expect.stringMatching(/^[a-f0-9]{64}$/)],
          tutorModel: { requested: "pilot-model" },
          judgeModel: { requested: "judge-model", returned: ["judge-model"] },
          judgePrompt: {
            revision: expect.any(String),
            prompts: [{
              scenarioId: "TQ-SEM-001",
              sampleIndex: 0,
              digest: expect.stringMatching(/^[a-f0-9]{64}$/),
              systemDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
              userDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            }],
          },
          temperature: { tutor: 0.2, judge: 0 },
        },
      });
      expect(reportJson).not.toMatch(/tutor-secret|judge-secret/);
      expect(reportMarkdown).toContain("TQ-SEM-001 / sample 0");
      expect(reportMarkdown).toContain("| TQ-SEM-001 | accepts-correct-answer | 1 | 0 | 0 |");
      expect(reportMarkdown).not.toMatch(/tutor-secret|judge-secret/);
      const transcriptFiles = await readdir(path.join(outputDir, "transcripts"));
      expect(transcriptFiles).toEqual(["transcript-TQ-SEM-001-0.json"]);
      expect(await readFile(path.join(outputDir, "transcripts", transcriptFiles[0]!), "utf8")).not.toMatch(/tutor-secret|judge-secret/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe("Tutor Quality CLI exit codes (R-VER-8)", () => {
  const cleanGit = { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true };

  function verdictReport(
    runStatus: "completed" | "not-run" | "invalid",
    verdict: "pass" | "warn" | "fail" | "inconclusive",
  ) {
    return { runStatus, qualityVerdict: { ...computeTutorQualityVerdict({ runStatus, samplesPerCase: 3, judgeConfigured: true, samples: [], semanticEvaluations: [] }), verdict } };
  }

  it("maps the verdict to distinct exit codes and exempts only not-run from inconclusive", () => {
    expect(TUTOR_QUALITY_EXIT_CODES).toEqual({ success: 0, cliError: 1, qualityFail: 2, inconclusive: 3 });
    expect(tutorQualityExitCode(verdictReport("completed", "pass"))).toBe(0);
    expect(tutorQualityExitCode(verdictReport("completed", "warn"))).toBe(0);
    expect(tutorQualityExitCode(verdictReport("completed", "fail"))).toBe(2);
    expect(tutorQualityExitCode(verdictReport("completed", "inconclusive"))).toBe(3);
    expect(tutorQualityExitCode(verdictReport("invalid", "inconclusive"))).toBe(3);
    expect(tutorQualityExitCode(verdictReport("not-run", "inconclusive"))).toBe(0);
  });

  async function main(
    args: readonly string[],
    rating: 1 | 2 | 3 | 4 | 5 | "throw",
    options: { readonly environment?: NodeJS.ProcessEnv; readonly git?: typeof cleanGit } = {},
  ) {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-cli-exit-"));
    const lines: string[] = [];
    const errors: string[] = [];
    const provider: LLMProvider = {
      async listModels() { return ["pilot-model"]; },
      async generateLearningQuestion() {
        if (rating === "throw") throw new TutorProviderError("provider-timeout");
        return { model: "pilot-model", result: { responseStyle: "normal" as const, answerRating: rating, feedback: "Kurz eingeordnet.", question: "Welche Beobachtung ist im Sketch belegt?" } };
      },
    };
    try {
      const exitCode = await runTutorQualityCliMain([
        "--model", "pilot-model",
        "--credential-env", "TEST_TUTOR_CREDENTIAL",
        "--case", "strategy-learn-strong-answer",
        "--output-dir", outputDir,
        ...args,
      ], {
        cwd: process.cwd(),
        environment: options.environment ?? { TEST_TUTOR_CREDENTIAL: "secret-value" },
        provider,
        git: options.git ?? cleanGit,
        log: (line) => lines.push(line),
        error: (line) => errors.push(line),
      });
      return { exitCode, summary: lines.length ? JSON.parse(lines[0]!) as Record<string, unknown> : undefined, lines, errors };
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  // strategy-learn-strong-answer declares answerRating [3, 5].
  it("exits 0 for pass and prints the verdict in the summary line", async () => {
    const { exitCode, summary } = await main(["--samples", "2", "--max-calls", "20"], 4);

    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({ runStatus: "completed", qualityVerdict: "pass" });
  });

  it("exits 0 for warn (one isolated rating outside the band)", async () => {
    const { exitCode, summary } = await main(["--samples", "1", "--max-calls", "20"], 1);

    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({ qualityVerdict: "warn" });
  });

  it("exits 2 for fail (the rating outside the band repeats)", async () => {
    const { exitCode, summary } = await main(["--samples", "2", "--max-calls", "20"], 1);

    expect(exitCode).toBe(2);
    expect(summary).toMatchObject({ qualityVerdict: "fail" });
  });

  it("exits 3 for inconclusive technical failures and invalid runs", async () => {
    const technical = await main(["--samples", "1", "--max-calls", "20"], "throw");
    const dirty = await main(["--samples", "1", "--max-calls", "20"], 4, { git: { ...cleanGit, trackedClean: false } });

    expect(technical).toMatchObject({ exitCode: 3, summary: { runStatus: "completed", qualityVerdict: "inconclusive" } });
    expect(dirty).toMatchObject({ exitCode: 3, summary: { runStatus: "invalid", reason: "dirty-relevant-worktree", qualityVerdict: "inconclusive" } });
  });

  it("exits 0 for a not-run caused by a missing credential (R-PYR-2)", async () => {
    const { exitCode, summary } = await main(["--samples", "1", "--max-calls", "20"], 4, { environment: {} });

    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({ runStatus: "not-run", reason: "missing-credential", qualityVerdict: "inconclusive" });
  });

  it("exits 0 without provider calls for a not-run caused by a missing Judge credential (R-PYR-2)", async () => {
    const { exitCode, summary } = await main([
      "--samples", "1", "--max-calls", "20",
      "--judge-model", "judge-model", "--judge-credential-env", "TEST_JUDGE_CREDENTIAL",
    ], 4);

    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({
      runStatus: "not-run",
      reason: "missing-judge-credential",
      qualityVerdict: "inconclusive",
      providerCalls: { total: 0 },
    });
  });

  it("exits 1 for a CLI error without a verdict", async () => {
    const { exitCode, lines, errors } = await main(["--unknown-flag", "x"], 4);

    expect(exitCode).toBe(1);
    expect(lines).toEqual([]);
    expect(errors).toEqual(["Unknown Tutor Quality evaluation option: --unknown-flag"]);
  });
});
