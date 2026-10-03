import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

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

describe("Tutor Quality real-provider workflow triggers", () => {
  it("keeps manual dispatch with its inputs and has no schedule", () => {
    // L3 runs before relevant Tutor changes, locally or by deliberate dispatch. Without provider
    // secrets a schedule would only report a green not-run, which looks like a regular measurement.
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    const dispatch = workflow.on.workflow_dispatch as { inputs: Record<string, unknown> };
    expect(Object.keys(dispatch.inputs).sort()).toEqual(["case", "judge_model", "max_calls", "model", "samples"]);
  });

  it("has no pull_request or push trigger (R-PYR-2)", () => {
    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.on).not.toHaveProperty("pull_request_target");
    expect(workflow.on).not.toHaveProperty("push");
  });

  it("never overlaps another evaluation", () => {
    expect(workflow.concurrency).toEqual({ group: "tutor-quality-real-provider", "cancel-in-progress": false });
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });
});

describe("manual L3 configuration", () => {
  it("keeps the manual inputs for workflow_dispatch", () => {
    const manual = runEvaluationScript({ TUTOR_MODEL: "manual-model", JUDGE_MODEL: "manual-judge", SAMPLES: "2", MAX_CALLS: "12", CASE_ID: "TQ-SEM-001" });
    const executionOnly = runEvaluationScript({ TUTOR_MODEL: "manual-model", JUDGE_MODEL: "", SAMPLES: "1", MAX_CALLS: "5", CASE_ID: "" });

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
    const manual = { TUTOR_MODEL: "m", JUDGE_MODEL: "", SAMPLES: "1", MAX_CALLS: "5", CASE_ID: "" };

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
