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
      // flag to disable baudrate delays during Playwright tests
      (window as any).__PLAYWRIGHT_TEST__ = true;
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await simulationToggle.click();
        const didStart = await expect
          .poll(() => simulationToggle.getAttribute("aria-label"), {
            timeout: 15000,
            intervals: [250, 500, 1000],
          })
          .toMatch(/stop simulation/i)
          .then(() => true)
          .catch(() => false);
        if (didStart) {
          // wait for compile round‑trip so UI has settled
          await page.waitForResponse(
            (resp) => resp.url().includes("/api/compile") && resp.status() === 200,
            { timeout: 15000 }
          ).catch(() => {});
          // also ensure some running-state indicator present
          await page.waitForSelector('text=Running', { timeout: 10000 }).catch(() => {});
          return;
        }
        await expect(simulationToggle).toBeEnabled({ timeout: 5000 });
      }
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
