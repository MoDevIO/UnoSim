import { expect, test, type Page } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { config } from "../server/config";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { TutorService } from "../server/services/tutor/tutor-service";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";

// Real browser -> real routes/service -> real provider adapter -> controlled loopback model.
let apiUrl: string;
const servers: Server[] = [];
let calls: string[] = [];
let failGraphic = false;
let heldGraphic: { gate: Promise<void>; started: () => void } | undefined;
const saved = { baseUrl: config.tutor.baseUrl, models: config.tutor.autoModels };
async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
test.beforeAll(async () => {
  const provider = express();
  provider.use(express.json());
  provider.get("/models", (_req, res) => res.json({ data: [{ id: "graphics-model" }] }));
  provider.post("/chat/completions", async (req, res) => {
    const system = String(req.body.messages?.[0]?.content ?? "");
    const user = String(req.body.messages?.[1]?.content ?? "");
    let content: Record<string, unknown>;
    if (system.includes('Erzeuge ausschließlich ein JSON-Objekt')) {
      calls.push("graphic");
      if (heldGraphic) { heldGraphic.started(); await heldGraphic.gate; }
      if (failGraphic) { res.status(503).json({ error: "controlled graphic failure" }); return; }
      const question = JSON.parse(user).question;
      content = { mermaid: question.includes("pinMode") ? "flowchart LR\nA[Neue Frage] --> B[Kontext]" : "flowchart LR\nA[Startfrage] --> B[Ablauf]" };
    } else if (user.startsWith("Erzeuge eine einzige Lernfrage")) {
      calls.push("initial");
      content = { question: "Welche Reihenfolge erkennst du im Sketch?", responseStyle: "normal" };
    } else if (user.startsWith("Führe den sokratischen Lerndialog")) {
      calls.push("dialog");
      content = { question: "Welche Rolle hat pinMode in setup?", feedback: "Richtig.", answerRating: 5, responseStyle: "normal" };
    } else { calls.push("unexpected"); res.status(400).json({ error: "unexpected prompt" }); return; }
    res.json({ model: "graphics-model", choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  config.tutor.baseUrl = await listen(provider);
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["graphics-model"];
  const api = express();
  api.use(express.json());
  api.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "e2e-graphics", roles: ["user"] }; next(); });
  registerTutorRoutes(api, { service: new TutorService(new KiconnectProvider()), disableRateLimit: true });
  apiUrl = await listen(api);
});
test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  config.tutor.baseUrl = saved.baseUrl;
  (config.tutor as { autoModels: readonly string[] }).autoModels = saved.models;
});
test.beforeEach(() => { calls = []; failGraphic = false; heldGraphic = undefined; });

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
  });
  // This fixture explicitly exercises the legacy Mermaid protocol.
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), tutorGraphics: undefined } });
  });
  await page.route("**/api/tutor/**", async (route) => {
    const incoming = route.request();
    const response = await page.request.post(`${apiUrl}${new URL(incoming.url()).pathname}`, { headers: { "content-type": "application/json" }, data: incoming.postData() ?? "{}" });
    await route.fulfill({ status: response.status(), contentType: "application/json", body: await response.body() });
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("open-settings")));
  const toggle = page.getByRole("checkbox", { name: "Grafiken immer anfordern" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("tutor-setup-action").click();
  await page.getByLabel("API-Key", { exact: true }).fill("PRIVATE_CONTROLLED_E2E_KEY");
  await page.getByTestId("tutor-apply-key").click();
  await page.getByTestId("tutor-start-question").click();
}

test("Settings requests graphics for new questions and holds the next graphic until Weiter", async ({ page }, info) => {
  await open(page);
  const preview = page.getByTestId("tutor-mermaid");
  await expect(preview).toContainText("Startfrage");
  await expect(preview.locator("svg rect")).toHaveCount(2);
  await expect(preview.locator("path[marker-end]")).toHaveCount(1);
  expect(calls).toEqual(["initial", "graphic"]);
  expect(await page.evaluate(() => localStorage.getItem("unoTutorGraphicsMode"))).toBe("always");
  await page.locator("#tutor-answer").fill("setup läuft einmal, loop danach wiederholt.");
  await page.getByTestId("tutor-send-answer").click();
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  await expect(preview).toContainText("Startfrage");
  await expect(page.getByTestId("tutor-question")).not.toContainText("Welche Rolle");
  expect(calls).toEqual(["initial", "graphic", "dialog", "graphic"]);
  await page.getByTestId("tutor-continue").click();
  await expect(page.getByTestId("tutor-question")).toContainText("Welche Rolle hat pinMode");
  await expect(preview).toContainText("Neue Frage");
  expect(calls).toHaveLength(4);
  await page.screenshot({ path: info.outputPath("requested-graphic.png"), fullPage: true });
});

test("a failed graphic generation preserves the usable question and shows its failure", async ({ page }, info) => {
  failGraphic = true;
  await open(page);
  await expect(page.getByTestId("tutor-question")).toContainText("Welche Reihenfolge");
  await expect(page.getByText("Grafik konnte nicht bereitgestellt werden.", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-answer")).toBeEnabled();
  await expect(page.getByTestId("tutor-mermaid")).toHaveCount(0);
  expect(calls).toEqual(["initial", "graphic"]);
  await page.screenshot({ path: info.outputPath("graphic-unavailable.png"), fullPage: true });
});


test("changing Settings while a graphic is running affects the following action only", async ({ page }) => {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  heldGraphic = { gate: new Promise<void>((resolve) => { release = resolve; }), started: markStarted };
  try {
    await open(page);
    await started;
    await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("open-settings")));
    await page.getByRole("checkbox", { name: "Grafiken immer anfordern" }).uncheck();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    release();
    await expect(page.getByTestId("tutor-mermaid")).toContainText("Startfrage");
    await page.locator("#tutor-answer").fill("setup läuft einmal, loop danach wiederholt.");
    await page.getByTestId("tutor-send-answer").click();
    await expect(page.getByTestId("tutor-continue")).toBeVisible();
    await page.getByTestId("tutor-continue").click();
    await expect(page.getByTestId("tutor-question")).toContainText("Welche Rolle hat pinMode");
    await expect(page.getByTestId("tutor-mermaid")).toHaveCount(0);
    expect(calls).toEqual(["initial", "graphic", "dialog"]);
  } finally { release(); }
});
