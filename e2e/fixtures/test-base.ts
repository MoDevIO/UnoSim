import { test as base, expect, type Locator, type Page } from "@playwright/test";
import "../matchers/arduino-matchers";
import { MonacoEditor } from "../pom/MonacoEditor";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export type TestFixtures = {
  monacoEditor: MonacoEditor;
  compilerDir: string;
  testRunId: string;
  simulationToggle: Locator;
  startSimulation: () => Promise<void>;
  stopSimulation: () => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  testRunId: async ({}, use, workerInfo) => {
    const id = `pw-${workerInfo.workerIndex}-${randomUUID()}`;
    await use(id);
  },
  compilerDir: async ({ testRunId }, use) => {
    const dir = join(process.cwd(), "temp", testRunId);
    await mkdir(dir, { recursive: true });
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
  page: async ({ page, testRunId }, use) => {
    await page.addInitScript((id: string) => {
      window.sessionStorage.setItem("__TEST_RUN_ID__", id);
    }, testRunId);
    await use(page);
  },
  monacoEditor: async ({ page }, use) => {
    const editor = new MonacoEditor(page, page.locator(".monaco-editor"));
    await use(editor);
  },
  simulationToggle: async ({ page }, use) => {
    const toggle = page.locator('[data-testid="button-simulate-toggle"]');
    await use(toggle);
  },
  startSimulation: async ({ simulationToggle, page }, use) => {
    await use(async () => {
      await expect(simulationToggle).toBeVisible();
      const currentLabel = await simulationToggle.getAttribute("aria-label");
      if (currentLabel && /stop simulation/i.test(currentLabel)) {
        return;
      }

      await expect(simulationToggle).toBeEnabled({ timeout: 15000 });

      // Backend-aware retry: detect /api/compile 429 and retry with exponential backoff
      const maxAttempts = 5;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        // Click to start (UI triggers /api/compile)
        await simulationToggle.click();

        // Wait for a compile response if present (short window) so we can detect 429
        let compileResp;
        try {
          compileResp = await page.waitForResponse(
            (r) => r.url().includes('/api/compile') && r.request().method() === 'POST',
            { timeout: 5000 },
          );
        } catch (err) {
          compileResp = undefined;
        }

        // If server returned 429, apply exponential backoff and retry click
        if (compileResp && compileResp.status() === 429) {
          const backoff = 250 * Math.pow(2, attempt); // 250ms, 500ms, 1s, 2s...
          console.warn(`[E2E] /api/compile returned 429 — backing off ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await page.waitForTimeout(backoff);
          // ensure toggle is enabled again before next attempt
          await expect(simulationToggle).toBeEnabled({ timeout: 5000 });
          continue; // retry
        }

        // If compileResp exists and is an error other than 429, allow normal retry behavior
        if (compileResp && !compileResp.ok() && compileResp.status() !== 429) {
          console.warn(`[E2E] /api/compile returned status ${compileResp.status()} — retrying`);
        }

        // Wait for UI to reflect started state (shorter poll because we already clicked)
        const didStart = await expect
          .poll(() => simulationToggle.getAttribute("aria-label"), {
            timeout: 8000,
            intervals: [250, 500, 1000],
          })
          .toMatch(/stop simulation/i)
          .then(() => true)
          .catch(() => false);

        if (didStart) return;

        // If not started yet, back off before retrying
        const backoff = 250 * Math.pow(2, attempt);
        await page.waitForTimeout(backoff);
        await expect(simulationToggle).toBeEnabled({ timeout: 5000 });
      }

      // Final assertion (will fail the test and surface the reason)
      await expect(simulationToggle).toHaveAttribute("aria-label", /stop simulation/i);
    });
  },
  stopSimulation: async ({ simulationToggle }, use) => {
    await use(async () => {
      await expect(simulationToggle).toBeVisible();
      const currentLabel = await simulationToggle.getAttribute("aria-label");
      if (currentLabel && /start simulation|resume simulation/i.test(currentLabel)) {
        return;
      }
      // Simulation is running, click to stop it
      await expect(simulationToggle).toBeEnabled({ timeout: 5000 });
      await simulationToggle.click();
      
      // Wait for simulation to stop with polling
      await expect.poll(
        async () => {
          const label = await simulationToggle.getAttribute("aria-label");
          return label && /start simulation|resume simulation/i.test(label);
        },
        { timeout: 20000, intervals: [500, 1000, 2000] }
      ).toBe(true);
    });
  },
});

export { expect } from "@playwright/test";
export type { Locator, Page };
