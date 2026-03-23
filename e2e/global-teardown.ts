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

async function globalTeardown(): Promise<void> {
  const HR = "═".repeat(60);
  console.log(`\n${HR}`);
  console.log("  GLOBAL TEARDOWN — STABILITY INTEGRITY CHECK");
  console.log(HR);

  // ── 1. Race condition summary ──────────────────────────────────────────
  let total = 0;
  let flaky = 0;
  let suppressed = 0;

  if (existsSync(SUMMARY_FILE)) {
    try {
      const raw = readFileSync(SUMMARY_FILE, "utf8");
      const summary = JSON.parse(raw) as {
        total: number;
        flaky: number;
        suppressed: number;
        detections: Array<{
          testTitle: string;
          wasFlaky: boolean;
          finalStatus: string;
          triggerLine: string;
        }>;
      };

      total      = summary.total      ?? 0;
      flaky      = summary.flaky      ?? 0;
      suppressed = summary.suppressed ?? 0;

      console.log(`\n  📊  Race Condition Summary`);
      console.log(`      Total detected  : ${total}`);
      console.log(`      Suppressed      : ${suppressed}  (test ultimately passed)`);
      console.log(`      Flaky           : ${flaky}  (failed then passed on retry)`);

      if (total > 0) {
        console.log("\n  Affected tests:");
        for (const d of summary.detections ?? []) {
          const tag = d.wasFlaky ? "[FLAKY+STABILITY_WARNING]" : "[STABILITY_WARNING]";
          const icon = d.finalStatus === "passed" ? "⚠️ " : "❌";
          console.log(`    ${icon}  ${d.testTitle}  ${tag}`);
          console.log(`         ${d.triggerLine.trim()}`);
        }
      }
    } catch (err) {
      console.error("  ⚠️  Could not parse race-condition summary:", err);
    }
  } else {
    console.log(
      "\n  ℹ️  No race-condition summary file found — reporter may not have run.",
    );
  }

  // ── 2. Leaked-process check (CI or explicit opt-in) ───────────────────
  const runLeakCheck =
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.LEAK_CHECK === "1";

  if (runLeakCheck && existsSync(LEAK_CHECK_SCRIPT)) {
    console.log("\n  🔍  Running compiler-process leak check…");
    try {
      const output = execFileSync("bash", [LEAK_CHECK_SCRIPT, "--cleanup"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      // Print indented so it's clearly nested under the teardown block
      for (const line of output.split("\n")) {
        console.log("  " + line);
      }
    } catch (err: any) {
      // execFileSync throws for non-zero exit
      const output: string = err.stdout ?? "";
      const stderr: string = err.stderr ?? "";
      for (const line of (output + stderr).split("\n")) {
        console.log("  " + line);
      }
      console.error(
        "\n  ❌  check-leaks.sh reported leaked compiler processes — see output above.",
      );
      // Don't throw here; let the threshold check below decide the final code
      // so both issues are reported together.
      process.exitCode = 1;
    }
  }

  // ── 3. Threshold enforcement ──────────────────────────────────────────
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
    console.log(
      `\n  ⚠️   ${total} race condition(s) detected and suppressed.`,
    );
    console.log(
      "      Within acceptable threshold — suite continues as passed.",
    );
  } else {
    console.log("\n  ✅  No race conditions detected. Environment is stable.");
  }

  console.log(`\n${HR}\n`);
}

export default globalTeardown;
