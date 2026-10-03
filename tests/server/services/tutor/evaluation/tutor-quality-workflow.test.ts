import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadTutorQualityEvaluationScenarios, runTutorQualityCli } from "../../../../../scripts/tutor-quality-real-provider-eval";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

// Contract of the L3 workflow (Evaluation SSOT §4, R-PYR-2, R-BUD-2, R-VER-8, Appendix B).
// Offline: the workflow's run script is executed with a stub `npm`; no provider is called.

const WORKFLOW_PATH = ".github/workflows/tutor-quality-real-provider.yml";

interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}

interface Workflow {
  readonly on: Record<string, unknown>;
  readonly env: Record<string, string>;
  readonly concurrency: { readonly group: string; readonly "cancel-in-progress": boolean };
  readonly jobs: Record<string, { readonly if?: string; readonly "timeout-minutes"?: number; readonly steps: readonly WorkflowStep[] }>;
}

const workflow = parseYaml(readFileSync(WORKFLOW_PATH, "utf8")) as Workflow;
const job = Object.values(workflow.jobs)[0]!;
const evaluationStep = job.steps.find(({ run }) => run?.includes("eval:tutor-quality:real"))!;
const uploadStep = job.steps.find(({ uses }) => uses?.startsWith("actions/upload-artifact@"))!;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Runs the workflow's evaluation script as GitHub does (`bash -e`), with `npm` stubbed to exit `npmExit`. */
function runEvaluationScript(environment: Record<string, string>, npmExit = 0) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "unosim-tq-workflow-"));
  directories.push(directory);
  const argsFile = path.join(directory, "npm-args");
  writeFileSync(path.join(directory, "npm"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${argsFile}"\nexit ${npmExit}\n`);
  chmodSync(path.join(directory, "npm"), 0o755);
  const script = path.join(directory, "step.sh");
  writeFileSync(script, evaluationStep.run!);
  const result = spawnSync("bash", ["-e", script], {
    env: { PATH: `${directory}:${process.env.PATH ?? ""}`, ...workflow.env, ...environment },
    encoding: "utf8",
  });
  let args: string[] = [];
  try {
    args = readFileSync(argsFile, "utf8").trimEnd().split("\n");
  } catch {
    args = [];
  }
  return { status: result.status, args };
}

function option(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** Every provider call of one sample of every case, counted on the real call graph with a fake provider. */
async function callsPerSampleOverCorpus(): Promise<{ tutorCalls: number; judgeCalls: number }> {
  const scenarios = await loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml");
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "unosim-tq-workflow-budget-"));
  directories.push(outputDir);
  let tutorCalls = 0;
  let judgeCalls = 0;
  for (const scenario of scenarios) {
    const rating = (scenario.expected?.answerRating?.[0] ?? 5) as 1 | 2 | 3 | 4 | 5;
    const provider: LLMProvider & { generateStructuredResponse(request: { readonly userPrompt: string }): Promise<{ model: string; result: unknown }> } = {
      async listModels() { return ["tutor-model", "judge-model"]; },
      async generateLearningQuestion() {
        return { model: "tutor-model", result: { responseStyle: "normal" as const, answerRating: rating, feedback: "Kurz eingeordnet.", question: "Welche Beobachtung ist im aktuellen Sketch belegt?" } };
      },
      async generateStructuredResponse(request) {
        const input = JSON.parse(request.userPrompt.split("\n").at(-1) ?? "{}") as { criteria: readonly { readonly id: string }[] };
        return { model: "judge-model", result: { criteria: input.criteria.map(({ id }) => ({ id, verdict: "pass", reason: "synthetic" })), criticalIssues: [] } };
      },
    };
    const { report } = await runTutorQualityCli([
      "--model", "tutor-model", "--judge-model", "judge-model",
      "--credential-env", "TEST_TUTOR_CREDENTIAL", "--judge-credential-env", "TEST_JUDGE_CREDENTIAL",
      "--samples", "1", "--max-calls", "100", "--case", scenario.id, "--output-dir", outputDir,
    ], {
      cwd: process.cwd(),
      environment: { TEST_TUTOR_CREDENTIAL: "tutor", TEST_JUDGE_CREDENTIAL: "judge" },
      provider,
      git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    });
    expect(report.runStatus).toBe("completed");
    // Minus the run-level preflight model list, which the budget counts once per run.
    tutorCalls += report.providerCalls.modelListCalls - 1 + report.providerCalls.generationCalls;
    judgeCalls += report.providerCalls.judgeCalls;
  }
  return { tutorCalls, judgeCalls };
}

describe("Tutor Quality real-provider workflow triggers", () => {
  it("keeps manual dispatch with its inputs and adds exactly one weekly schedule", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const dispatch = workflow.on.workflow_dispatch as { inputs: Record<string, unknown> };
    expect(Object.keys(dispatch.inputs).sort()).toEqual(["case", "judge_model", "max_calls", "model", "samples"]);
    const schedule = workflow.on.schedule as readonly { readonly cron: string }[];
    expect(schedule).toHaveLength(1);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = schedule[0]!.cron.split(/\s+/);
    // Weekly, never nightly: one fixed minute, hour, and weekday.
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dayOfMonth, month]).toEqual(["*", "*"]);
    expect(dayOfWeek).toMatch(/^[0-6]$/);
  });

  it("has no pull_request or push trigger (R-PYR-2)", () => {
    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.on).not.toHaveProperty("pull_request_target");
    expect(workflow.on).not.toHaveProperty("push");
  });

  it("runs a scheduled evaluation only on main and never overlaps another evaluation", () => {
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.concurrency).toEqual({ group: "tutor-quality-real-provider", "cancel-in-progress": false });
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });
});

describe("scheduled L3 configuration", () => {
  it("uses fixed Tutor and Judge model IDs and an odd sample count", () => {
    expect(workflow.env).toMatchObject({
      SCHEDULED_TUTOR_MODEL: "openai-gpt5.4-mini",
      SCHEDULED_JUDGE_MODEL: "openai-gpt5.5",
      SCHEDULED_SAMPLES: "5",
    });
    expect(Number(workflow.env.SCHEDULED_SAMPLES) % 2).toBe(1);
  });

  it("sets the call budget computed by R-BUD-2 from the current call graph over the full corpus", async () => {
    const samples = Number(workflow.env.SCHEDULED_SAMPLES);
    const { tutorCalls, judgeCalls } = await callsPerSampleOverCorpus();

    // 1 preflight model list + samples × (Tutor calls of all turns + Judge calls of all judged cases).
    expect(Number(workflow.env.SCHEDULED_MAX_CALLS)).toBe(1 + samples * tutorCalls + samples * judgeCalls);
  });

  it("passes the scheduled configuration over the full corpus with both credential names", () => {
    const { status, args } = runEvaluationScript({ EVENT_NAME: "schedule", TUTOR_MODEL: "", JUDGE_MODEL: "", SAMPLES: "", MAX_CALLS: "", CASE_ID: "" });

    expect(status).toBe(0);
    expect(args.slice(0, 2)).toEqual(["run", "eval:tutor-quality:real"]);
    expect(option(args, "--model")).toBe("openai-gpt5.4-mini");
    expect(option(args, "--judge-model")).toBe("openai-gpt5.5");
    expect(option(args, "--samples")).toBe(workflow.env.SCHEDULED_SAMPLES);
    expect(option(args, "--max-calls")).toBe(workflow.env.SCHEDULED_MAX_CALLS);
    expect(option(args, "--credential-env")).toBe("UNOSIM_TUTOR_EVAL_CREDENTIAL");
    expect(option(args, "--judge-credential-env")).toBe("UNOSIM_TUTOR_JUDGE_CREDENTIAL");
    expect(args).not.toContain("--case");
  });

  it("keeps the manual inputs for workflow_dispatch", () => {
    const manual = runEvaluationScript({ EVENT_NAME: "workflow_dispatch", TUTOR_MODEL: "manual-model", JUDGE_MODEL: "manual-judge", SAMPLES: "2", MAX_CALLS: "12", CASE_ID: "TQ-SEM-001" });
    const executionOnly = runEvaluationScript({ EVENT_NAME: "workflow_dispatch", TUTOR_MODEL: "manual-model", JUDGE_MODEL: "", SAMPLES: "1", MAX_CALLS: "5", CASE_ID: "" });

    expect(manual.args).toEqual([
      "run", "eval:tutor-quality:real", "--",
      "--model", "manual-model", "--samples", "2", "--max-calls", "12",
      "--credential-env", "UNOSIM_TUTOR_EVAL_CREDENTIAL", "--output-dir", ".tutor-quality-output",
      "--judge-model", "manual-judge", "--judge-credential-env", "UNOSIM_TUTOR_JUDGE_CREDENTIAL",
      "--case", "TQ-SEM-001",
    ]);
    expect(executionOnly.args).not.toContain("--judge-model");
    expect(executionOnly.args).not.toContain("--case");
  });

  it("reads secrets only into the named environment variables of the evaluation step", () => {
    expect(evaluationStep.env).toMatchObject({
      UNOSIM_TUTOR_EVAL_CREDENTIAL: "${{ secrets.UNOSIM_TUTOR_EVAL_CREDENTIAL }}",
      UNOSIM_TUTOR_JUDGE_CREDENTIAL: "${{ secrets.UNOSIM_TUTOR_JUDGE_CREDENTIAL }}",
    });
    expect(evaluationStep.run).not.toMatch(/secrets\.|echo .*CREDENTIAL|set -x/);
  });
});

describe("workflow result and artifacts (R-VER-8)", () => {
  it("propagates the CLI exit code to the step result", () => {
    const manual = { EVENT_NAME: "workflow_dispatch", TUTOR_MODEL: "m", JUDGE_MODEL: "", SAMPLES: "1", MAX_CALLS: "5", CASE_ID: "" };

    expect(runEvaluationScript(manual, 0).status).toBe(0);
    expect(runEvaluationScript(manual, 2).status).toBe(2);
    expect(runEvaluationScript(manual, 3).status).toBe(3);
  });

  it("uploads reports and transcripts with bounded retention even when the evaluation step fails", () => {
    expect(uploadStep.if).toBe("always()");
    expect(uploadStep.with).toMatchObject({
      name: "tutor-quality-run-${{ github.run_id }}-${{ github.run_attempt }}",
      path: ".tutor-quality-output/",
      "retention-days": 28,
    });
  });

  it("checks out the triggering commit without credentials persisted in Git", () => {
    const checkout = job.steps.find(({ uses }) => uses?.startsWith("actions/checkout@"))!;
    expect(checkout.with).toMatchObject({ "persist-credentials": false });
  });
});
