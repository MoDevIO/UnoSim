/**
 * global-teardown.ts
 *
 * Playwright global teardown script.
 *
 * Responsibilities:
 *  1. Read the race-condition summary produced by RaceConditionReporter.
 *  2. Print a human-readable final summary to the console.
 *  3. Fail the suite (exit code 1) if the threshold was exceeded.
 *  4. Optionally run the check-leaks.sh script to catch any leaked compiler
 *     processes that survived the test run (only in CI or when LEAK_CHECK=1).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUMMARY_FILE = join(process.cwd(), "test-results", "race-condition-summary.json");
const RACE_CONDITION_THRESHOLD = 5;
const LEAK_CHECK_SCRIPT = join(process.cwd(), "check-leaks.sh");

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

const SAFE_PATH = "/bin:/usr/bin";

type RaceConditionDetection = {
  testTitle: string;
  wasFlaky: boolean;
  finalStatus: string;
  triggerLine: string;
};

type RaceConditionSummary = {
  total: number;
  flaky: number;
  suppressed: number;
  detections: RaceConditionDetection[];
};

async function globalTeardown(): Promise<void> {
  const hr = "═".repeat(60);
  console.log(`\n${hr}`);
  console.log("  GLOBAL TEARDOWN — STABILITY INTEGRITY CHECK");
  console.log(hr);

  const summary = readRaceConditionSummary();
  printRaceConditionSummary(summary);
  runLeakCheckIfEnabled();
  enforceThreshold(summary.total);

  console.log(`\n${hr}\n`);
}

function readRaceConditionSummary(): RaceConditionSummary {
  if (!existsSync(SUMMARY_FILE)) {
    console.log(
      "\n  ℹ️  No race-condition summary file found — reporter may not have run.",
    );
    return { total: 0, flaky: 0, suppressed: 0, detections: [] };
  }

  try {
    const raw = readFileSync(SUMMARY_FILE, "utf8");
    const summary = JSON.parse(raw) as RaceConditionSummary;

    return {
      total: summary.total ?? 0,
      flaky: summary.flaky ?? 0,
      suppressed: summary.suppressed ?? 0,
      detections: summary.detections ?? [],
    };
  } catch (err) {
    console.error("  ⚠️  Could not parse race-condition summary:", err);
    return { total: 0, flaky: 0, suppressed: 0, detections: [] };
  }
}

function printRaceConditionSummary(summary: RaceConditionSummary): void {
  console.log(`\n  📊  Race Condition Summary`);
  console.log(`      Total detected  : ${summary.total}`);
  console.log(`      Suppressed      : ${summary.suppressed}  (test ultimately passed)`);
  console.log(`      Flaky           : ${summary.flaky}  (failed then passed on retry)`);

  if (summary.total > 0) {
    console.log("\n  Affected tests:");
    for (const detection of summary.detections) {
      const tag = detection.wasFlaky
        ? "[FLAKY+STABILITY_WARNING]"
        : "[STABILITY_WARNING]";
      const icon = detection.finalStatus === "passed" ? "⚠️ " : "❌";
      console.log(`    ${icon}  ${detection.testTitle}  ${tag}`);
      console.log(`         ${detection.triggerLine.trim()}`);
    }
  }
}

function runLeakCheckIfEnabled(): void {
  const shouldRunLeakCheck =
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.LEAK_CHECK === "1";

  if (!shouldRunLeakCheck || !existsSync(LEAK_CHECK_SCRIPT)) {
    return;
  }

  console.log("\n  🔍  Running compiler-process leak check…");

  try {
    const output = execFileSync("/bin/bash", [LEAK_CHECK_SCRIPT, "--cleanup"], {
      encoding: "utf8",
      timeout: 15_000,
      env: { PATH: SAFE_PATH },
    });

    for (const line of output.split("\n")) {
      console.log("  " + line);
    }
  } catch (err: any) {
    const output: string = err.stdout ?? "";
    const stderr: string = err.stderr ?? "";
    for (const line of (output + stderr).split("\n")) {
      console.log("  " + line);
    }
    console.error(
      "\n  ❌  check-leaks.sh reported leaked compiler processes — see output above.",
    );
    process.exitCode = 1;
  }
}

function enforceThreshold(total: number): void {
  if (total > RACE_CONDITION_THRESHOLD) {
    console.log(
      `\n  ❌  INTEGRITY FAILURE: ${total} race conditions exceed threshold of ${RACE_CONDITION_THRESHOLD}.`,
    );
    console.log(
      "      The test suite passed, but the environment is structurally unstable.",
    );
    console.log(
      "      Investigate parallel file-system contention or RAM-disk exhaustion.",
    );
    process.exitCode = 1;
  } else if (total > 0) {
    console.log(`\n  ⚠️   ${total} race condition(s) detected and suppressed.`);
    console.log("      Within acceptable threshold — suite continues as passed.");
  } else {
    console.log("\n  ✅  No race conditions detected. Environment is stable.");
  }
}

export default globalTeardown;
