import { expect, test, type Page } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { config } from "../server/config";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { TutorService } from "../server/services/tutor/tutor-service";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";

// Both the Tutor API and OpenAI-compatible provider use real loopback HTTP.
// The page bridge redirects only Tutor traffic; no production test endpoint is introduced.
let apiUrl: string;
let graphic = "";
let providerCalls = 0;
// KI:connect answers a listed alias with a provider-specific version name; tests may imitate that.
let returnedModel = "test-model";
let servers: Server[] = [];
const saved = { baseUrl: config.tutor.baseUrl, models: config.tutor.autoModels, diagnostics: config.tutor.diagnosticsEnabled };
const key = "PRIVATE_E2E_KEY_SENTINEL";

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test.beforeAll(async () => {
  const provider = express();
  provider.use(express.json());
  provider.get("/models", (_req, res) => res.json({ data: [{ id: "test-model" }] }));
  provider.post("/chat/completions", (req, res) => {
    const followUp = String(req.body.messages?.[1]?.content ?? "").includes("Aktuelle Nutzerantwort:");
    providerCalls++;
    res.json({ model: returnedModel, choices: [{ message: { content: JSON.stringify({ responseStyle: "normal", question: followUp ? "Welche Verbindung erklärt den Signalweg zwischen den Bausteinen?" : "Welche Reihenfolge erkennst du im Sketch?", feedback: "Verfolge den Ablauf im Sketch.", answerRating: 5, ...(graphic ? { mermaid: graphic } : {}) }) } }] });
  });
  config.tutor.baseUrl = await listen(provider);
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["test-model"];
  config.tutor.diagnosticsEnabled = true;
  const api = express();
  api.use(express.json());
  api.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "e2e-tutor", roles: ["user"] }; next(); });
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

async function open(page: Page, xxl = false) {
  await page.addInitScript((large) => {
    localStorage.setItem("unoDebugMode", "1");
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
    if (large) localStorage.setItem("unoFontScale", "1.5");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (globalThis as unknown as Record<string, unknown>).__debugCopied = text; } } });
  }, xxl);
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
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question")).toContainText("Welche Reihenfolge");
}

async function debug(page: Page) {
  await page.getByRole("tab", { name: /debug/i }).dblclick();
  await page.getByRole("tab", { name: /debug/i }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("tutor");
}

for (const example of [
  { name: "flow", source: "flowchart LR\nA[setup] --> B[loop] --> C[Ausgabe]", label: "Ausgabe" },
  { name: "state", source: "stateDiagram-v2\nAus --> An : Taster gedrückt", label: "Taster gedrückt" },
  { name: "sequence", source: "sequenceDiagram\nSketch->>Serial: Ausgabe", label: "Ausgabe" },
]) {
  test(`renders ${example.name} through Provider, HTTP API and Tutor DOM with safe Debug export`, async ({ page }, info) => {
    graphic = example.source;
    await open(page);
    await expect(page.getByTestId("tutor-mermaid").locator("svg")).toBeVisible();
    await expect(page.getByTestId("tutor-mermaid")).toContainText(example.label);
    await debug(page);
    await page.getByLabel("Processing stage", { exact: true }).selectOption("renderer");
    await expect(page.getByText("renderer: rendered", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copy debug messages", exact: true }).click();
    const copied = await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__debugCopied as string);
    expect(copied).toContain('"diagramId"');
    expect(copied).toContain('"outcome":"rendered"');
    expect(copied).not.toContain(key);
    expect(copied).not.toContain(example.source);
    expect(copied).not.toContain("Welche Reihenfolge");
    await page.getByText("Details", { exact: true }).click();
    await expect(page.locator("details[open] code")).toContainText('"origin": "renderer"');
    await page.screenshot({ path: info.outputPath(`tutor-debug-${example.name}.png`), fullPage: true });
  });
}

test("reports a dialog without graphics as information and names the returned model version", async ({ page }) => {
  graphic = "";
  returnedModel = "test-model-2026-11-01";
  try {
    await open(page);
    await page.locator("#tutor-answer").fill("Zuerst läuft setup, danach wiederholt sich loop.");
    await page.getByTestId("tutor-send-answer").click();
    await expect(page.getByTestId("tutor-continue")).toBeVisible();
    await page.getByTestId("tutor-continue").click();
    await expect(page.getByTestId("tutor-question")).toContainText("Welche Verbindung");
    await expect(page.getByTestId("tutor-mermaid")).toHaveCount(0);
    await debug(page);
    await page.getByLabel("Processing stage", { exact: true }).selectOption("parsing");
    // One missing-field event for the question and one for the answer; neither is a rejection.
    await expect(page.getByText("parsing: not-provided (not-provided)", { exact: true })).toHaveCount(2);
    await page.getByLabel("Processing stage", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Copy debug messages", exact: true }).click();
    const copied = await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__debugCopied as string);
    expect(copied).toContain('"modelRequested":"test-model"');
    expect(copied).toContain('"modelReturned":"test-model-2026-11-01"');
    for (const alarm of ['"outcome":"rejected"', '"outcome":"failed"', '"stage":"safety"', '"stage":"renderer"', "model-id-not-listed", "model-id-withheld"]) {
      expect(copied).not.toContain(alarm);
    }
    expect(copied).not.toContain(key);
  } finally {
    returnedModel = "test-model";
  }
});

test("retains the text question and explains rejected graphics without active content", async ({ page }) => {
  graphic = "flowchart LR\nA[<img src=x onerror=globalThis.__diagramAttack=1>] --> B";
  await open(page);
  await expect(page.getByTestId("tutor-mermaid")).toHaveCount(0);
  await debug(page);
  await page.getByLabel("Processing stage", { exact: true }).selectOption("safety");
  await expect(page.getByText("safety: rejected (markup-disallowed)", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__diagramAttack)).toBeUndefined();
  await page.getByRole("button", { name: "Copy debug messages", exact: true }).click();
  const copied = await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__debugCopied as string);
  expect(copied).not.toContain("onerror");
  expect(copied).not.toContain(key);
});

test("keeps held graphics separate from rendering and exposes details at XXL", async ({ page }, info) => {
  graphic = "";
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-font-scale").trim())).toBe("1.5");
  graphic = "flowchart TD\nA[Start] --> B[Weiter]";
  await page.locator("#tutor-answer").fill("Die erste Funktion beginnt.");
  await page.getByTestId("tutor-send-answer").click();
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  await expect(page.getByTestId("tutor-mermaid")).toHaveCount(0);
  await page.getByTestId("tutor-continue").click();
  await expect(page.getByTestId("tutor-mermaid").locator("svg")).toBeVisible();
  await debug(page);
  await page.getByLabel("Processing outcome", { exact: true }).selectOption("held");
  await expect(page.getByText("browser: held (awaiting-continue)", { exact: true })).toBeVisible();
  const before = providerCalls;
  await page.getByRole("button", { name: "Switch to tiles view", exact: true }).click();
  await page.getByText("Details", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details[open] code")).toContainText('"reason": "awaiting-continue"');
  expect(providerCalls).toBe(before);
  await page.screenshot({ path: info.outputPath("tutor-debug-xxl.png"), fullPage: true });
});
