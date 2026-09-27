import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadTutorQualityEvaluationScenarios,
  parseTutorQualityCliArgs,
  runTutorQualityCli,
} from "../../../../../scripts/tutor-quality-real-provider-eval";
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
      expect(scenarios).toHaveLength(10);
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
        samplesRequested: 10,
        samplesObserved: 10,
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
});
