import { expect, test, type Page } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { config } from "../server/config";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { TutorService } from "../server/services/tutor/tutor-service";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import { TutorUmlRenderer } from "../server/services/tutor/uml/renderer";
import { activity, activityCode, arduinoCode, arduinoCycle, classes, classCode, sequence, sequenceCode, it086Code, it086Question } from "../tests/server/services/tutor/uml/contract-fixtures";

// Browser -> real API -> real provider adapter -> controlled local model -> pinned PlantUML process.
const servers: Server[] = [];
const renderer = new TutorUmlRenderer();
const saved = { baseUrl: config.tutor.baseUrl, models: config.tutor.autoModels };
let apiUrl: string;
let proposal: unknown;
let question = "";
let sourceFile = "main.ino";
let primaryHasDiagram = false;
let unavailable = false;
let modelCalls: string[] = [];
let renderCalls = 0;
let lastResponse: Record<string, unknown>;
async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
function boundProposal() {
  return JSON.parse(JSON.stringify(proposal), (key, value) => key === "file" ? sourceFile : value);
}
test.beforeAll(async () => {
  expect(await renderer.available(), "Provision the pinned runtime with npm run provision:tutor-uml before these real-renderer tests").toBe(true);
  const provider = express(); provider.use(express.json());
  provider.get("/models", (_req, res) => res.json({ data: [{ id: "classic-model" }] }));
  provider.post("/chat/completions", (req, res) => {
    const graphic = String(req.body.messages?.[0]?.content ?? "").startsWith("Erzeuge ausschließlich ein JSON-Objekt mit dem Feld diagram.");
    const dialog = String(req.body.messages?.[1]?.content ?? "").startsWith("Führe den sokratischen Lerndialog");
    modelCalls.push(graphic ? "graphic" : dialog ? "dialog" : "initial");
    const content = graphic ? { diagram: boundProposal() } : { question: dialog ? `Nächste Frage: ${question}` : question, responseStyle: "normal", ...(dialog ? { feedback: "Richtig.", answerRating: 5 } : {}), ...(primaryHasDiagram ? { diagram: boundProposal() } : {}) };
    res.json({ model: "classic-model", choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  config.tutor.baseUrl = await listen(provider);
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["classic-model"];
  const api = express(); api.use(express.json());
  api.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "classic-uml-e2e", roles: ["user"] }; next(); });
  registerTutorRoutes(api, { disableRateLimit: true, service: new TutorService(new KiconnectProvider(), undefined, { renderer: {
    available: async () => !unavailable && await renderer.available(),
    render: async (...args) => { renderCalls++; return renderer.render(...args); },
  } }) });
  apiUrl = await listen(api);
});
test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  config.tutor.baseUrl = saved.baseUrl;
  (config.tutor as { autoModels: readonly string[] }).autoModels = saved.models;
});
test.beforeEach(() => { modelCalls = []; renderCalls = 0; unavailable = false; primaryHasDiagram = false; lastResponse = {}; });
async function open(page: Page, code: string, always = true) {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
  });
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), tutorGraphics: { profiles: ["uml1-classic-v1"], available: !unavailable } } });
  });
  await page.route("**/api/tutor/**", async (route) => {
    const incoming = route.request(); const body = incoming.postDataJSON() as Record<string, unknown>;
    sourceFile = typeof body.entryFile === "string" ? body.entryFile : "sketch.ino";
    if (!incoming.url().endsWith("/models")) expect(body.graphicsProfile).toBe("uml1-classic-v1");
    const response = await page.request.post(`${apiUrl}${new URL(incoming.url()).pathname}`, { data: body });
    lastResponse = await response.json();
    await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(lastResponse) });
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.evaluate((value) => ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue(code: string): void }).setValue(value), code);
  await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("open-settings")));
  const toggle = page.getByRole("checkbox", { name: "Grafiken immer anfordern" });
  await expect(toggle).not.toBeChecked();
  if (always) await toggle.check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("tutor-setup-action").click();
  await page.getByLabel("API-Key", { exact: true }).fill("CONTROLLED_UML_E2E_KEY");
  await page.getByTestId("tutor-apply-key").click();
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question").locator("p").first()).toHaveText(question.replaceAll("`", ""));
  expect(lastResponse.question).toBe(question);
  if (question.includes("`")) await expect(page.getByTestId("tutor-question").locator("code")).toHaveText(["mittelwert(4, 8)", "mittelwert"]);
}
async function geometry(page: Page) {
  const source = (lastResponse.diagram as { image: { svg: string } }).image.svg;
  return page.getByTestId("tutor-uml").locator("img").evaluate(async (img: HTMLImageElement, source: string) => {
    await img.decode();
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    return { source, text: doc.documentElement.textContent ?? "", polygons: doc.querySelectorAll("polygon").length, ellipses: doc.querySelectorAll("ellipse").length, lines: doc.querySelectorAll("line").length, dashed: doc.querySelectorAll('[style*="stroke-dasharray"]').length, minFont: Math.min(...[...doc.querySelectorAll("text")].map((node) => Number(node.getAttribute("font-size")))), width: img.naturalWidth, height: img.naturalHeight };
  }, source);
}
for (const fixture of [
  { name: "activity", diagram: activity, code: activityCode, question: "Wie verzweigt der Ablauf und wo treffen die beiden Pfade wieder zusammen?", labels: ["ready", "on();", "off();", "after();"] },
  { name: "class", diagram: classes, code: classCode, question: "Wie stehen Base und Child mit ihren deklarierten Membern in Beziehung?", labels: ["Base", "Child", "value", "go(int x)", "peer"] },
  { name: "sequence", diagram: sequence, code: sequenceCode, question: "In welcher Reihenfolge interagiert run mit dem Objekt sensor?", labels: ["run", "sensor", "sensor.read()", "return 1;"] },
]) test(`renders useful ${fixture.name} notation through the real renderer with readable scroll and accessible zoom`, async ({ page }, info) => {
  proposal = fixture.diagram; question = fixture.question;
  await open(page, fixture.code);
  const img = page.getByTestId("tutor-uml").locator("img"); await expect(img).toBeVisible();
  const result = await geometry(page);
  for (const label of fixture.labels) expect(result.text).toContain(label);
  expect(result.minFont).toBeGreaterThanOrEqual(14);
  expect(result.width).toBeGreaterThan(80); expect(result.height).toBeGreaterThan(80);
  if (fixture.name === "activity") { expect(result.polygons).toBeGreaterThanOrEqual(2); expect(result.ellipses).toBeGreaterThanOrEqual(2); }
  if (fixture.name === "class") expect(result.polygons).toBeGreaterThanOrEqual(1);
  if (fixture.name === "sequence") expect(result.dashed).toBeGreaterThanOrEqual(3);
  expect(modelCalls).toEqual(["initial", "graphic"]); expect(renderCalls).toBe(1);
  await expect(page.getByTestId("tutor-uml").locator("svg")).toHaveCount(0);
  for (const scale of [1, 1.5]) for (const width of [320, 480, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("[data-layout-mode]")).toHaveAttribute("data-layout-mode", width < 768 ? "mobile" : "tablet");
    await page.getByRole("button", { name: "Tutor", exact: true }).click();
    await expect(page.getByTestId("mobile-layout")).toContainText("tutor");
    await expect(img).toBeVisible();
    await page.evaluate((value) => document.documentElement.style.setProperty("--ui-font-scale", String(value)), scale);
    const metrics = await img.evaluate((node: HTMLImageElement) => ({ rendered: node.getBoundingClientRect().width, natural: node.naturalWidth, parentWidth: node.parentElement!.clientWidth, scrollWidth: node.parentElement!.scrollWidth, overflow: getComputedStyle(node.parentElement!).overflowX }));
    expect(metrics.rendered).toBeCloseTo(metrics.natural * scale, 0);
    expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.rendered - 1);
    expect(metrics.overflow).toBe("auto");
    expect(metrics.parentWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`${fixture.name}-${width}-${scale}.png`) });
  }
  const url = await img.getAttribute("src");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await img.getAttribute("src")).toBe(url);
  const trigger = page.getByRole("button", { name: "UML-Grafik vergrößern" });
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "UML-Grafik zur aktuellen Frage" }); await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveAttribute("src", url!);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(modelCalls).toHaveLength(2); expect(renderCalls).toBe(1);
});

test("auto accepts a useful primary proposal without a graphic model call", async ({ page }) => {
  proposal = classes; question = "Wie stehen Base und Child in Beziehung?"; primaryHasDiagram = true;
  await open(page, classCode, false); await expect(page.getByTestId("tutor-uml").locator("img")).toBeVisible();
  expect(modelCalls).toEqual(["initial"]); expect(renderCalls).toBe(1);
});
test("a next image stays hidden until Weiter and reuses its delivered rendering", async ({ page }) => {
  proposal = activity; question = "Wie verzweigt der Ablauf und wo treffen die beiden Pfade wieder zusammen?";
  await open(page, activityCode); const previous = await page.getByTestId("tutor-uml").locator("img").getAttribute("src");
  await page.locator("#tutor-answer").fill("Beide Pfade erreichen after."); await page.getByTestId("tutor-send-answer").click();
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  const nextQuestion = String(lastResponse.question);
  expect(nextQuestion).not.toBe(question);
  await expect(page.getByTestId("tutor-question")).not.toContainText(nextQuestion);
  expect(await page.getByTestId("tutor-uml").locator("img").getAttribute("src")).toBe(previous);
  expect(renderCalls).toBe(2); expect(modelCalls).toEqual(["initial", "graphic", "dialog", "graphic"]);
  await page.getByTestId("tutor-continue").click(); await expect(page.getByTestId("tutor-question")).toContainText(nextQuestion);
  await expect(page.getByTestId("tutor-uml").locator("img")).toBeVisible(); expect(renderCalls).toBe(2); expect(modelCalls).toHaveLength(4);
});
for (const negative of [
  { name: "comment action", code: "void setup() {\n // on();\n}\nvoid loop() {}", question: "Wie wird on im Ablauf erreicht?", diagram: { ...activity, scope: { file: "main.ino", startLine: 1, endLine: 4 }, body: [{ type: "action", code: "on();", ref: { file: "main.ino", startLine: 2, endLine: 2 } }] } },
  { name: "invented datatype class", code: "int measured = 0;", question: "Welchen Datentyp hat die betrachtete Variable?", diagram: classes },
  { name: "solved function test", code: it086Code, question: it086Question, diagram: { ...activity, scope: { file: "main.ino", startLine: 4, endLine: 6 }, body: [{ type: "action", code: "Soll-Wert 6.0; Test erfolgreich wegen Ganzzahldivision", ref: { file: "main.ino", startLine: 5, endLine: 5 } }] } },
]) test(`rejects ${negative.name} while retaining the exact usable question`, async ({ page }) => {
  proposal = negative.diagram; question = negative.question;
  await open(page, negative.code);
  await expect(page.getByText("Grafik konnte nicht bereitgestellt werden.", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-answer")).toBeEnabled(); await expect(page.getByTestId("tutor-uml")).toHaveCount(0);
  expect(renderCalls).toBe(0); expect(modelCalls).toEqual(["initial", "graphic"]);
});
test("an explicit not-useful keeps its explanation state without retry or busy spinner", async ({ page }) => {
  proposal = { version: 1, profile: "uml1-classic-v1", status: "not-useful", reason: "answer-leak", explanation: "Die Grafik würde die gesuchte Begründung verraten." }; question = it086Question;
  await open(page, it086Code);
  await expect(page.getByText("Zu dieser Frage ist keine hilfreiche zusätzliche UML-Grafik verfügbar.", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-answer")).toBeEnabled(); expect(modelCalls).toEqual(["initial", "graphic"]); expect(renderCalls).toBe(0);
  await expect(page.getByTestId("tutor-pending")).toBeEmpty();
});
test("known unavailable renderer keeps the text and avoids the graphic model call", async ({ page }) => {
  unavailable = true; proposal = activity; question = "Wie verzweigt der Ablauf?";
  await open(page, activityCode);
  await expect(page.getByText("Grafik konnte nicht bereitgestellt werden.", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-answer")).toBeEnabled(); expect(modelCalls).toEqual(["initial"]); expect(renderCalls).toBe(0);
});


test("renders the pinned Arduino callback cycle without an invented endpoint", async ({ page }) => {
  proposal = arduinoCycle; question = "Welche Reihenfolge und Wiederholung erkennst du zwischen setup und loop?";
  await open(page, arduinoCode);
  await expect(page.getByTestId("tutor-uml").locator("img")).toBeVisible();
  const result = await geometry(page);
  for (const label of ["setup()", "loop()", "pinMode(13, 1);", "digitalWrite(13, 1);"]) expect(result.text).toContain(label);
  expect(result.ellipses).toBe(1); // The cycle has one start and no fabricated bullseye endpoint.
  expect(result.text.match(/setup\(\)/g)).toHaveLength(1);
  expect(result.text.match(/loop\(\)/g)).toHaveLength(1);
  expect(result.minFont).toBeGreaterThanOrEqual(14);
  expect(modelCalls).toEqual(["initial", "graphic"]); expect(renderCalls).toBe(1);
});
