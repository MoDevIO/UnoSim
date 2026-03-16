/**
 * race-condition-reporter.ts
 *
 * Playwright custom reporter that scans all test output (stdout + stderr) for
 * the [RaceCondition] marker introduced in LocalCompiler.  When the marker is
 * found the test is labelled STABILITY_WARNING regardless of its final outcome.
 *
 * At the end of the suite the reporter writes a summary JSON file consumed by
 * global-teardown.ts and prints a human-readable summary to the console.
 *
 * Severity threshold: if more than RACE_CONDITION_THRESHOLD race conditions
 * are detected the reporter overrides the suite exit code to 1, even when
 * every test nominally passed.
 */

import type {
  Reporter,
  TestCase,
  TestResult,
  FullConfig,
  Suite,
  FullResult,
} from "@playwright/test/reporter";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** String that LocalCompiler injects when a file-system race is detected. */
const RACE_MARKER = "[RaceCondition]";

/**
 * If the total detected count exceeds this value the suite will be marked
 * as failed, even at 100 % test success, because a recurring structural
 * problem exists in the test environment.
 */
const RACE_CONDITION_THRESHOLD = 5;

/** Path of the JSON hand-off file read by global-teardown. */
const SUMMARY_FILE = join(process.cwd(), "test-results", "race-condition-summary.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RaceDetection {
  testTitle: string;
  testFile: string;
  retryIndex: number;
  finalStatus: TestResult["status"];
  wasFlaky: boolean;
  /** The first log line that contained the marker. */
  triggerLine: string;
  /** All unique log lines that contained the marker. */
  allMarkerLines: string[];
  /** ISO timestamp when the detection was recorded. */
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Reporter implementation
// ---------------------------------------------------------------------------

class RaceConditionReporter implements Reporter {
  private detections: RaceDetection[] = [];
  /**
   * Map from test-id → array of all result statuses seen, so we can
   * determine "flakiness" (test passed on a retry after earlier failures).
   */
  private testHistory = new Map<string, TestResult["status"][]>();

  onBegin(_config: FullConfig, _suite: Suite): void {
    // nothing to do on begin
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = test.titlePath().join(" > ");

    // Accumulate result history to detect flakiness
    const history = this.testHistory.get(id) ?? [];
    history.push(result.status);
    this.testHistory.set(id, history);

    // Scan all stdout / stderr attachments and log entries for the marker
    const markerLines = this._extractMarkerLines(result);
    if (markerLines.length === 0) return;

    const wasFlaky =
      history.length > 1 &&
      result.status === "passed" &&
      history.slice(0, -1).some((s) => s === "failed" || s === "timedOut");

    const detection: RaceDetection = {
      testTitle: test.title,
      testFile: test.location.file,
      retryIndex: result.retry,
      finalStatus: result.status,
      wasFlaky,
      triggerLine: markerLines[0],
      allMarkerLines: [...new Set(markerLines)],
      detectedAt: new Date().toISOString(),
    };

    this.detections.push(detection);

    // Annotate the test with a STABILITY_WARNING label so it appears in the
    // HTML report even if it passed / was retried to green.
    test.annotations.push({
      type: "STABILITY_WARNING",
      description: `[RaceCondition] detected during this test run (retry #${result.retry}).`,
    });
  }

  onEnd(_result: FullResult): void {
    const total = this.detections.length;
    const flaky = this.detections.filter((d) => d.wasFlaky).length;
    const suppressed = this.detections.filter(
      (d) => d.finalStatus === "passed",
    ).length;

    // Persist summary for global teardown
    this._writeSummary({ total, flaky, suppressed, detections: this.detections });

    // Console output
    const HR = "─".repeat(60);
    console.log(`\n${HR}`);
    console.log("  RACE CONDITION STABILITY REPORT");
    console.log(HR);

    if (total === 0) {
      console.log("  ✅  No [RaceCondition] events detected.");
    } else {
      console.log(`  ⚠️  Race conditions detected : ${total}`);
      console.log(`      Suppressed (test passed)  : ${suppressed}`);
      console.log(`      Flaky (failed then passed) : ${flaky}`);
      console.log("");
      for (const d of this.detections) {
        const icon = d.wasFlaky ? "🔀" : d.finalStatus === "passed" ? "⚠️ " : "❌";
        const label = d.wasFlaky ? " [FLAKY + STABILITY_WARNING]" : " [STABILITY_WARNING]";
        console.log(`  ${icon}  ${d.testTitle}${label}`);
        console.log(`        ${d.triggerLine.trim()}`);
      }
    }

    if (total > RACE_CONDITION_THRESHOLD) {
      console.log("");
      console.log(
        `  ❌  THRESHOLD EXCEEDED: ${total} race conditions > limit of ${RACE_CONDITION_THRESHOLD}.`,
      );
      console.log(
        "      This indicates a structural performance problem in the CI environment.",
      );
    }

    console.log(HR + "\n");

    // Signal suite failure by overriding the process exit code when above threshold.
    // Playwright does not let reporters change FullResult, so we use process.exitCode.
    if (total > RACE_CONDITION_THRESHOLD) {
      process.exitCode = 1;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _extractMarkerLines(result: TestResult): string[] {
    const lines: string[] = [];

    // 1. Inline log entries (test.info().log / console.log captured by PW)
    for (const entry of result.stdout) {
      this._scanChunk(entry, lines);
    }
    for (const entry of result.stderr) {
      this._scanChunk(entry, lines);
    }

    // 2. Named attachments (e.g. captured server logs written to a file)
    for (const attachment of result.attachments) {
      if (attachment.body) {
        this._scanChunk(attachment.body, lines);
      }
    }

    // 3. Errors — scan the message and stack for the marker too
    for (const error of result.errors) {
      if (error.message) this._scanString(error.message, lines);
      if (error.stack)   this._scanString(error.stack,   lines);
    }

    return lines;
  }

  private _scanChunk(chunk: string | Buffer, out: string[]): void {
    const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    this._scanString(str, out);
  }

  private _scanString(str: string, out: string[]): void {
    for (const line of str.split(/\r?\n/)) {
      if (line.includes(RACE_MARKER)) {
        out.push(line);
      }
    }
  }

  private _writeSummary(data: {
    total: number;
    flaky: number;
    suppressed: number;
    detections: RaceDetection[];
  }): void {
    try {
      mkdirSync(dirname(SUMMARY_FILE), { recursive: true });
      writeFileSync(SUMMARY_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.error("[RaceConditionReporter] Could not write summary file:", err);
    }
  }
}

export default RaceConditionReporter;
