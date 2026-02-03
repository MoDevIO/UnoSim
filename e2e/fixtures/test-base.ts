import { test as base, type Locator, type Page } from "@playwright/test";
import "../matchers/arduino-matchers";
import { MonacoEditor } from "../pom/MonacoEditor";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export type TestFixtures = {
  monacoEditor: MonacoEditor;
  compilerDir: string;
  testRunId: string;
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
});

export { expect } from "@playwright/test";
export type { Locator, Page };
