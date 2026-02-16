import { test, expect } from "./fixtures/test-base";
import fs from "fs";
import path from "path";

const BASELINE_NAME = "baseline-simulator.png";
// Use repository-relative path instead of __dirname (not available in ESM test runtime)
const BASELINE_PATH = path.join(process.cwd(), "e2e", BASELINE_NAME);

test.describe("Visual baseline — Simulator UI", () => {
  test("create baseline (use UPDATE_BASELINE=1 to write file)", async ({ page, monacoEditor, stopSimulation }, testInfo) => {
    // Only create/update baseline when explicitly requested.
    test.skip(process.env.UPDATE_BASELINE !== "1", "set UPDATE_BASELINE=1 to (re)create baseline");

    // Prevent accidental auto-start: prefer query param if supported, then ensure Idle
    await page.goto("/?noautostart=1");

    // Wait for Monaco editor to be ready
    await monacoEditor.waitForReady();

    // Ensure app is in Idle state (stop if it auto-started)
    await stopSimulation();

    // Wait for a stable board UI indicator (Show I/O values button)
    const showBtn = page.getByRole("button", { name: /show i\/o values/i });
    await expect(showBtn).toBeVisible({ timeout: 15000 });

    // Reveal I/O overlay so board details are visible in baseline (Idle state)
    await showBtn.click();
    await page.waitForTimeout(500);

    // Give layout a moment to stabilize then take full-page screenshot
    await page.waitForTimeout(300);
    const shot = await page.screenshot({ fullPage: true });

    // Persist baseline to repository-relative e2e/ directory
    await fs.promises.writeFile(BASELINE_PATH, shot);

    // Attach to Playwright report for convenience
    testInfo.attach("baseline", { body: shot, contentType: "image/png" });
  });

  test("compare current UI to baseline (visual regression)", async ({ page, monacoEditor, stopSimulation }) => {
    // Skip if baseline is not present — create it first with UPDATE_BASELINE=1
    test.skip(!fs.existsSync(BASELINE_PATH), "baseline missing - run with UPDATE_BASELINE=1 to create it");

    // Load page with a query param to discourage autostart and then ensure Idle
    await page.goto("/?noautostart=1");

    // Wait for Monaco editor and ensure Idle state
    await monacoEditor.waitForReady();
    await stopSimulation();

    const showBtn = page.getByRole("button", { name: /show i\/o values/i });
    await expect(showBtn).toBeVisible({ timeout: 15000 });

    // Make sure overlay is visible as in baseline
    await showBtn.click();
    await page.waitForTimeout(500);

    // Take a full-page screenshot and compare to committed baseline
    const current = await page.screenshot({ fullPage: true });
    const expected = await fs.promises.readFile(BASELINE_PATH);

    // Exact byte-level comparison — intentional strictness for CSS refactor guard
    expect(current).toEqual(expected);
  });
});
