import { expect, test, type Page } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { config } from "../server/config";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { TutorService } from "../server/services/tutor/tutor-service";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import { tutorReviewExportSchema } from "../shared/tutor-review";

/**
 * The Tutor review (LearningQuestions 12.7) through the real UI: a controlled provider, the real Tutor API,
 * the learner flow with "Weiter", a code change, a flood of technical messages and one copy action.
 */
let apiUrl: string;
let providerCalls = 0;
let servers: Server[] = [];
const saved = { baseUrl: config.tutor.baseUrl, models: config.tutor.autoModels, diagnostics: config.tutor.diagnosticsEnabled };
const key = "PRIVATE_E2E_REVIEW_KEY_SENTINEL";

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test.beforeAll(async () => {
  const provider = express();
  provider.use(express.json());
  provider.get("/models", (_req, res) => res.json({ data: [{ id: "review-model" }] }));
  provider.post("/chat/completions", (_req, res) => {
    providerCalls++;
    res.json({ model: "review-model-2026-11-01", choices: [{ message: { content: JSON.stringify({
      responseStyle: "normal",
      question: `Frage ${providerCalls}: Welche Zeile im Sketch bestimmt Schritt ${providerCalls}?`,
      feedback: `Rückmeldung ${providerCalls}: nachvollziehbar.`,
      answerRating: 5,
      ...(providerCalls === 1 ? { mermaid: "flowchart LR\n  A[setup] --> B[loop]" } : {}),
    }) } }] });
  });
  config.tutor.baseUrl = await listen(provider);
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["review-model"];
  config.tutor.diagnosticsEnabled = true;
  const api = express();
  api.use(express.json({ limit: "2mb" }));
  api.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "e2e-review", roles: ["user"] }; next(); });
  registerTutorRoutes(api, { service: new TutorService(new KiconnectProvider()), disableRateLimit: true });
  apiUrl = await listen(api);
});

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  servers = [];
  config.tutor.baseUrl = saved.baseUrl;
  (config.tutor as { autoModels: readonly string[] }).autoModels = saved.models;
  config.tutor.diagnosticsEnabled = saved.diagnostics;
});

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("unoDebugMode", "1");
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
    localStorage.setItem("unoFontScale", "1.5");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (globalThis as unknown as Record<string, unknown>).__copied = text; } } });
  });
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), tutorDiagnosticsAvailable: true } });
  });
  await page.route("**/api/tutor/**", async (route) => {
    const incoming = route.request();
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const name of ["x-unosim-tutor-debug", "x-unosim-tutor-trace-id", "x-request-id"]) {
      const value = incoming.headers()[name];
      if (value) headers[name] = value;
    }
    const response = await page.request.post(`${apiUrl}${new URL(incoming.url()).pathname}`, { headers, data: incoming.postData() ?? "{}" });
    await route.fulfill({ status: response.status(), contentType: "application/json", body: await response.body() });
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.getByTestId("tutor-setup-action").click();
  await page.getByLabel("API-Key", { exact: true }).fill(key);
  await page.getByTestId("tutor-apply-key").click();
}

const setCode = (page: Page, code: string) => page.evaluate((value) => {
  ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (code: string) => void }).setValue(value);
}, code);

test("copies one complete, self-contained Tutor review independent of filters and the message buffer", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page);
  await setCode(page, "int counter = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { counter++; delay(500); }");
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question")).toContainText("Frage 1");
  for (let turn = 1; turn <= 9; turn++) {
    // The sketch changes once in the middle of the run; later steps must reference the new state.
    if (turn === 5) await setCode(page, "int counter = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { counter += 2; Serial.println(counter); }");
    await page.locator("#tutor-answer").fill(`Antwort ${turn}: die Zeile mit counter.`);
    await page.getByTestId("tutor-send-answer").click();
    await expect(page.getByTestId("tutor-continue")).toBeVisible();
    await page.getByTestId("tutor-continue").click();
    // The Tutor may replace the provider's follow-up by its own rules; the review records whichever it shows.
    await expect(page.getByTestId("tutor-continue")).toHaveCount(0);
  }
  const calls = providerCalls;

  // More than 500 technical messages and active filters must not shrink the review.
  await page.evaluate(() => {
    for (let index = 0; index < 600; index++) {
      document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: {
        version: 1, traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
        origin: "frontend", operation: "models", stage: "request", outcome: "started",
      } }));
    }
  });
  await page.getByRole("tab", { name: /debug/i }).dblclick();
  await page.getByRole("tab", { name: /debug/i }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("tutor");
  await page.getByLabel("Processing stage", { exact: true }).selectOption("renderer");
  await page.getByLabel("Search debug messages", { exact: true }).fill("no-such-request");
  const panel = page.getByTestId("tutor-review-panel");
  await expect(panel).toContainText("records questions, answers, feedback and the sent code");
  await expect(panel).toContainText("complete run, independent of the message filter");
  await expect(page.getByTestId("tutor-review-size")).toHaveText(/^\d+\.\d KiB$/);

  // Keyboard and XXL: a step opens with Enter, and its text is wrapped plain text inside the panel.
  const steps = panel.getByText(/^Review steps \(\d+\)$/);
  await steps.focus();
  await page.keyboard.press("Enter");
  const firstStep = panel.locator("summary").filter({ hasText: "question" }).first();
  await firstStep.focus();
  await page.keyboard.press("Enter");
  const stepText = page.getByTestId("tutor-review-step-text").first();
  await expect(stepText).toContainText("Frage 1");
  expect(await stepText.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("pre-wrap");
  const box = await stepText.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(1100);

  await page.getByRole("button", { name: "Copy Tutor review", exact: true }).click();
  await expect(page.getByText("Tutor review copied", { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__copied as string);
  expect(providerCalls).toBe(calls);
  expect(copied).not.toContain(key);

  const json = copied.slice(copied.indexOf("\n== JSON ==\n") + 12, copied.lastIndexOf("\n=== ENDE UnoSim Tutor-Review"));
  const record = tutorReviewExportSchema.parse(JSON.parse(json));
  const answers = record.steps.filter((step) => step.kind === "answer");
  expect(answers).toHaveLength(9);
  expect(record.steps.filter((step) => step.kind === "displayed")).toHaveLength(9);
  expect(record.contexts).toHaveLength(2);
  expect(record.contexts.find((context) => context.contextId === answers[8].contextId)?.code).toContain("Serial.println(counter)");
  expect(record.contexts.find((context) => context.contextId === answers[0].contextId)?.code).not.toContain("Serial.println");
  // Each rating belongs to the question it answered; the next question is a separate field.
  expect(answers[0].request?.askedQuestion).toContain("Frage 1");
  expect(answers[0].response?.answerRating).toBe(5);
  for (let index = 0; index < answers.length - 1; index++) {
    expect(answers[index].response?.question).toBe(answers[index + 1].request?.askedQuestion);
  }
  expect(copied).toContain("Entscheidung:");
  const firstQuestion = record.steps.find((step) => step.kind === "question")!;
  expect(firstQuestion.server?.entries.some((entry) => entry.kind === "draft" && entry.mermaid?.includes("flowchart"))).toBe(true);
  expect(firstQuestion.events.some((event) => event.stage === "renderer" && event.outcome === "rendered")).toBe(true);
  expect(record.steps.every((step) => step.kind !== "models" || !step.request?.answer)).toBe(true);
  expect(copied).toContain("angefragt auto / zurückgemeldet review-model-2026-11-01");
  expect(copied).toContain(`Größe: ${(Buffer.byteLength(copied) / 1024).toFixed(1)} KiB`);
  expect(copied).toContain("Regelstand assessment-guidance-v1 (vom Server bestätigt)");
  await writeFile(info.outputPath("tutor-review-export.txt"), copied);
  await page.screenshot({ path: info.outputPath("tutor-review-panel.png"), fullPage: true });

  // The technical buffer dropped the early renderer event under the flood; the review above still has it.
  await page.getByLabel("Search debug messages", { exact: true }).fill("");
  await expect(page.getByText(/older messages removed \(buffer limit\)/)).toBeVisible();
  await expect(page.getByText("renderer: rendered", { exact: true })).toHaveCount(0);
  // The technical copy keeps its own, filtered scope.
  await page.getByLabel("Processing stage", { exact: true }).selectOption("request");
  await page.getByRole("button", { name: "Copy debug messages", exact: true }).click();
  const technical = await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__copied as string);
  expect(technical).not.toContain("== Protokoll ==");
  expect(technical).toContain("request: started");
});
