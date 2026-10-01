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
} from "../../../../../scripts/tutor-quality-real-provider-eval";
import {
  MAX_TUTOR_QUALITY_CALLS,
  MAX_TUTOR_QUALITY_SAMPLES,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

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
    const provider: LLMProvider = {
      async listModels() {
        return ["pilot-model"];
      },
      async generateLearningQuestion() {
        return {
          model: "pilot-model",
          result: {
            responseStyle: "normal" as const,
            answerRating: 5 as const,
            question: "Welche konkrete Beobachtung ist im aktuellen Sketch belegt?",
          },
        };
      },
    };
    try {
      expect(scenarios).toHaveLength(11);
      const result = await runTutorQualityCli([
        "--model", "pilot-model",
        "--samples", "1",
        "--max-calls", "100",
        "--credential-env", "TEST_TUTOR_CREDENTIAL",
        "--output-dir", outputDir,
      ], {
        cwd: process.cwd(),
        environment: { TEST_TUTOR_CREDENTIAL: "secret-value" },
        provider,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
      });
      expect(result.transcripts.find(({ scenario }) => scenario.id === "TQ-REG-001")?.stateAfter)
        .toEqual(result.transcripts.find(({ scenario }) => scenario.id === "TQ-REG-001")?.stateBefore);
      expect(result.transcripts.filter(({ invariantViolations }) => invariantViolations.length > 0).map(({ scenario, invariantViolations }) => ({ id: scenario.id, invariantViolations }))).toEqual([]);
      expect(result.report).toMatchObject({
        runStatus: "completed",
        samplesRequested: 11,
        samplesObserved: 11,
        invalid: 0,
        technicalFailures: 0,
        invariantViolationSamples: 0,
      });
      expect(result.report.providerCalls.generationCalls).toBeGreaterThan(0);
      expect(await readdir(outputDir)).toContain("report.json");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
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
