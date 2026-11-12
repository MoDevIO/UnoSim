import { expect, test, type Page } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { config } from "../server/config";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { createTutorService } from "../server/services/tutor/tutor-service-factory";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import { TutorSupportStore } from "../server/services/tutor/learning-support-store";
import { tutorReviewExportSchema } from "../shared/tutor-review";
import { IT064_CONCEPT_QUESTION, IT064_PREDICTION_QUESTION, IT064_SKETCH, it064Content } from "../tests/server/services/tutor/fixtures/it06-4";

/**
 * A complete mocked learning run through the real browser, the real Tutor API, the real TutorService with
 * its planner and stores, and the real provider adapter (Plan Aufgabe 6, LC-01..LC-05). Only the
 * OpenAI-compatible model endpoint and the Course Content source are controlled. The provider is strict:
 * every call is recorded, an unknown kind of call is a failure, and delayed answers are held by promises
 * the test releases (no sleeps).
 */

const KEY = "PRIVATE_E2E_LIFECYCLE_KEY_SENTINEL";
const GRAPHIC = "flowchart LR\n  A[a setzen] --> B[Bit prüfen]";
const plain = (text: string) => text.replaceAll("`", "");

type Kind = "question" | "dialog" | "explanation";
type Call = { kind: Kind; answer?: string; question?: string };
type Rated = { rating: 1 | 2 | 3 | 4 | 5; feedback: string; mermaid?: string };
type Hold = { release: () => void; started: Promise<void> };
/** How a held answer request ended on each side: the provider response, the Tutor API response, the browser route. */
type Settled = { providerFinished: boolean; apiStatus: number; route: "fulfill-returned" | `fulfill-threw: ${string}` };

let apiUrl: string;
let servers: Server[] = [];
let calls: Call[] = [];
let rate: (answer: string, question: string) => Rated = () => ({ rating: 5, feedback: "Stimmt." });
let holds = new Map<string, { gate: Promise<void>; markStarted: () => void }>();
let providerFinished = new Set<string>();
let settledRoutes = new Map<string, { promise: Promise<Settled>; resolve: (settled: Settled) => void }>();
let corruptReview = false;
const saved = { baseUrl: config.tutor.baseUrl, models: config.tutor.autoModels, diagnostics: config.tutor.diagnosticsEnabled };

function holdAnswer(answer: string): Hold {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  holds.set(answer, { gate, markStarted });
  return { release, started };
}

/** Resolves once the browser route of the answer request has ended, with how each side ended. */
function routeSettled(answer: string): Promise<Settled> {
  let entry = settledRoutes.get(answer);
  if (!entry) {
    let resolve!: (settled: Settled) => void;
    const promise = new Promise<Settled>((done) => { resolve = done; });
    entry = { promise, resolve };
    settledRoutes.set(answer, entry);
  }
  return entry.promise;
}

function part(prompt: string, label: string, end = "\n"): string {
  const start = prompt.indexOf(label);
  if (start < 0) return "";
  const from = start + label.length;
  const to = prompt.indexOf(end, from);
  return prompt.slice(from, to < 0 ? undefined : to);
}

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test.beforeAll(async () => {
  const provider = express();
  provider.use(express.json());
  provider.get("/models", (_req, res) => res.json({ data: [{ id: "lifecycle-model" }] }));
  provider.post("/chat/completions", async (req, res) => {
    const prompt = String(req.body.messages?.[1]?.content ?? "");
    let content: Record<string, unknown>;
    if (prompt.startsWith("Erzeuge eine einzige Lernfrage")) {
      calls.push({ kind: "question" });
      content = { responseStyle: "normal", question: "Welche Rolle spielt Serial.begin im Sketch?" };
    } else if (prompt.startsWith("Führe den sokratischen Lerndialog")) {
      const answer = part(prompt, "Aktuelle Nutzerantwort:\n```text\n", "\n```");
      const question = part(prompt, "Aktuelle Tutorfrage:\n");
      calls.push({ kind: "dialog", answer, question });
      const hold = holds.get(answer);
      if (hold) {
        hold.markStarted();
        await hold.gate;
        res.once("finish", () => providerFinished.add(answer));
      }
      const rated = rate(answer, question);
      content = { responseStyle: "normal", feedback: rated.feedback, question: "Was gibt der zweite Durchlauf aus?", answerRating: rated.rating, ...(rated.mermaid ? { mermaid: rated.mermaid } : {}) };
    } else if (prompt.includes("Aktuelle Frage:")) {
      calls.push({ kind: "explanation", question: part(prompt, "Aktuelle Frage:\n") });
      content = { responseStyle: "normal", feedback: `Gemeint ist der erste Durchlauf mit i = 7 (Erklärung ${calls.length}).`, question: part(prompt, "Aktuelle Frage:\n") };
    } else {
      res.status(500).json({ error: "unexpected prompt kind" });
      return;
    }
    res.json({ model: "lifecycle-model-2026-11-01", choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  config.tutor.baseUrl = await listen(provider);
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["lifecycle-model"];
  config.tutor.diagnosticsEnabled = true;
  const api = express();
  api.use(express.json({ limit: "2mb" }));
  api.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "e2e-lifecycle", roles: ["user"] }; next(); });
  registerTutorRoutes(api, {
    service: createTutorService(new KiconnectProvider()),
    supportStore: new TutorSupportStore(),
    courseContent: { resolveTutorContent: async () => it064Content() } as never,
    disableRateLimit: true,
  });
  apiUrl = await listen(api);
});

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  servers = [];
  config.tutor.baseUrl = saved.baseUrl;
  (config.tutor as { autoModels: readonly string[] }).autoModels = saved.models;
  config.tutor.diagnosticsEnabled = saved.diagnostics;
});

test.beforeEach(() => {
  calls = [];
  holds = new Map();
  providerFinished = new Set();
  settledRoutes = new Map();
  corruptReview = false;
  rate = () => ({ rating: 5, feedback: "Stimmt." });
});

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("unoDebugMode", "1");
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (globalThis as unknown as Record<string, unknown>).__copied = text; } } });
  });
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), tutorDiagnosticsAvailable: true } });
  });
  // The selected course: a repository at a pinned revision, so that the browser asks for Course Content itself.
  await page.route(/\/api\/examples(\?.*)?$/, (route) => route.fulfill({ json: {
    schemaVersion: 1,
    source: { selection: "default", mode: "repository-ref", repository: "ttbombadil/unosim-examples", ref: "main", revision: "6".repeat(40), status: "remote", stale: false, tutor: { status: "valid" } },
    examples: [],
  } }));
  await page.route("**/api/tutor/**", async (route) => {
    const incoming = route.request();
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const name of ["x-unosim-tutor-debug", "x-unosim-tutor-trace-id", "x-request-id"]) {
      const value = incoming.headers()[name];
      if (value) headers[name] = value;
    }
    const response = await page.request.post(`${apiUrl}${new URL(incoming.url()).pathname}`, { headers, data: incoming.postData() ?? "{}" });
    let body = await response.text();
    if (corruptReview && response.ok()) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if ("review" in parsed) body = JSON.stringify({ ...parsed, review: { version: 99, entries: "not-a-list" } });
    }
    const answer = (JSON.parse(incoming.postData() ?? "{}") as { answer?: unknown }).answer;
    const settle = (routeOutcome: Settled["route"]) => {
      if (typeof answer !== "string" || !holds.has(answer)) return;
      routeSettled(answer);
      settledRoutes.get(answer)!.resolve({ providerFinished: providerFinished.has(answer), apiStatus: response.status(), route: routeOutcome });
    };
    try {
      await route.fulfill({ status: response.status(), contentType: "application/json", body });
      settle("fulfill-returned");
    } catch (error) {
      settle(`fulfill-threw: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.getByTestId("tutor-setup-action").click();
  await page.getByLabel("API-Key", { exact: true }).fill(KEY);
  await page.getByTestId("tutor-apply-key").click();
}

const setCode = (page: Page, code: string) => page.evaluate((value) => {
  ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (code: string) => void }).setValue(value);
}, code);

const copied = (page: Page) => page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__copied as string | undefined);

async function send(page: Page, text: string) {
  await page.locator("#tutor-answer").fill(text);
  await page.getByTestId("tutor-send-answer").click();
}

/** The support state text the learner can read: counters of own answers and explanations of the question. */
async function supportStatus(page: Page): Promise<string> {
  if (await page.getByTestId("tutor-support-actions").count() === 0) await page.getByTestId("tutor-help-toggle").click();
  return (await page.getByTestId("tutor-support-status").textContent())?.replaceAll(/\s+/g, " ").trim() ?? "";
}

/** Starts the dialog and answers the focus concept question well, so that the prediction question is asked. */
async function toPrediction(page: Page) {
  await open(page);
  await setCode(page, IT064_SKETCH);
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question")).toContainText(plain(IT064_CONCEPT_QUESTION));
  rate = (_answer, question) => question === IT064_CONCEPT_QUESTION ? { rating: 5, feedback: "Ja." } : { rating: 2, feedback: "Noch nicht." };
  await send(page, "Sie maskiert genau das Bit i.");
  await page.getByTestId("tutor-continue").click();
  await expect(page.getByTestId("tutor-question")).toContainText(plain(IT064_PREDICTION_QUESTION));
}

const rating = (page: Page) => page.getByTestId("tutor-answer-rating");

/** Opens the Debug tab with the Tutor review panel, once; later calls only look at it. */
async function showDebug(page: Page) {
  if (await page.getByTestId("tutor-review-panel").isVisible()) return;
  await page.getByRole("tab", { name: /debug/i }).dblclick();
  await page.getByRole("tab", { name: /debug/i }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("tutor");
  await expect(page.getByTestId("tutor-review-panel")).toBeVisible();
}

/** Copies the Tutor review through the real button and parses the export. */
async function copiedReview(page: Page) {
  await showDebug(page);
  await page.getByRole("button", { name: "Copy Tutor review", exact: true }).click();
  const text = (await copied(page))!;
  const json = text.slice(text.indexOf("\n== JSON ==\n") + 12, text.lastIndexOf("\n=== ENDE UnoSim Tutor-Review"));
  return { text, record: tutorReviewExportSchema.parse(JSON.parse(json)) };
}

test("LC-01: question, clarification, weak attempt, reference decides against the model, Weiter - step by step", async ({ page }) => {
  test.setTimeout(120_000);
  await toPrediction(page);
  expect(calls.map((call) => call.kind)).toEqual(["question", "dialog"]);
  expect(await supportStatus(page)).toContain("0 eigene Antworten, 0 Erklärungen");

  // 1. A typed request for clarification: no stars, the question stays, nothing counted as an answer.
  const before = calls.length;
  await send(page, "Welche Variable meinst du?");
  await expect(page.getByTestId("tutor-clarification")).toBeVisible();
  await expect(rating(page)).toHaveCount(0);
  await expect(page.getByTestId("tutor-question")).toContainText(plain(IT064_PREDICTION_QUESTION));
  expect(await supportStatus(page)).toContain("0 eigene Antworten, 1 Erklärung");
  expect(calls.slice(before).map((call) => call.kind)).toEqual(["explanation"]);

  // 2. A weak answer attempt: two stars, the question stays open and the draft is kept editable.
  await send(page, "7");
  await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 2 von 5");
  await expect(page.getByTestId("tutor-question")).toContainText(plain(IT064_PREDICTION_QUESTION));
  await expect(page.getByTestId("tutor-continue")).toHaveCount(0);
  expect(await supportStatus(page)).toContain("1 eigene Antwort, 1 Erklärung");

  // 3. The model rates the correct answer 1 as 1 star and "falsch"; the reference decides.
  rate = (_answer, question) => question === IT064_CONCEPT_QUESTION ? { rating: 5, feedback: "Ja." } : { rating: 1, feedback: "Falsch, es wird 0 ausgegeben." };
  const callsBeforeCorrect = calls.length;
  await send(page, "1");
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 5 von 5");
  const step = page.getByTestId("tutor-current-step");
  await expect(step).toContainText("Richtig, das ist die gesuchte Antwort.");
  await expect(step).not.toContainText("Falsch");
  await expect(step).toContainText("Deine Antwort1");
  expect(calls.slice(callsBeforeCorrect).map((call) => `${call.kind}:${call.answer}`)).toEqual(["dialog:1"]);

  // 4. Weiter sends nothing and shows the next focus question.
  const callsBeforeNext = calls.length;
  await page.getByTestId("tutor-continue").click();
  await expect(page.getByTestId("tutor-question")).toContainText("Warum zählt die Schleife mit i-- von 7 herunter?");
  await expect(page.getByTestId("tutor-continue")).toHaveCount(0);
  await expect(page.locator("#tutor-answer")).toBeFocused();
  expect(calls).toHaveLength(callsBeforeNext);
  // The focus of the teacher: the first of two areas is understood. It is shown in the history view.
  await page.getByTestId("tutor-history-action").click();
  await expect(page.getByTestId("tutor-focus-status")).toHaveText("Fokus der Lehrkraft: 1 von 2 Bereichen verstanden");
  await page.getByTestId("tutor-back-to-question").click();
  await expect(page.getByTestId("tutor-question")).toContainText("Warum zählt die Schleife mit i-- von 7 herunter?");
  expect(calls).toHaveLength(callsBeforeNext);
});

test("LC-02: a late answer after a context switch does not overwrite the current question", async ({ page }) => {
  test.setTimeout(120_000);
  await toPrediction(page);
  const slow = holdAnswer("SPÄTE ANTWORT");
  const isLateRequest = (request: import("@playwright/test").Request) =>
    request.url().endsWith("/api/tutor/dialog") && (request.postData() ?? "").includes("SPÄTE ANTWORT");
  // Every end the browser reports for the late request, in order; a correct abort reports one failure and no finish.
  const browserEnds: string[] = [];
  page.on("requestfailed", (request) => { if (isLateRequest(request)) browserEnds.push(`failed: ${request.failure()?.errorText}`); });
  page.on("requestfinished", (request) => { if (isLateRequest(request)) browserEnds.push("finished"); });
  await send(page, "SPÄTE ANTWORT");
  await slow.started; // the provider has it; the browser waits for the response

  // While a request runs, a new round cannot be started: the menu entry is disabled.
  await page.getByTestId("tutor-menu").click();
  await expect(page.getByTestId("tutor-new-round-action")).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");

  // A context switch: another Example is loaded; the Tutor dialog is reset and the pending request aborted.
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page.getByRole("button", { name: "Built-in", exact: true }).click();
  await page.getByRole("button", { name: /01-blink\.ino/ }).click();
  await expect(page.getByTestId("tutor-start-question")).toBeVisible();
  await expect(page.getByTestId("tutor-question")).toHaveCount(0);
  // The browser gave the request up at the switch, before the provider answered: a failed, not a finished request.
  await expect.poll(() => browserEnds).toEqual(["failed: net::ERR_ABORTED"]);

  // Server and browser are separate: the provider call that was already running is not undone by the reset...
  slow.release();
  // ...it runs to its end: the provider response and the Tutor API response are complete, and the route handler has
  // handed the result over. The browser had given the request up, so nothing reaches the page: no finish follows the
  // abort. (That the hook drops a late result that is really fulfilled is shown in tutor-late-dialog-answer.test.tsx.)
  const settled = await routeSettled("SPÄTE ANTWORT");
  expect(settled).toEqual({ providerFinished: true, apiStatus: 200, route: "fulfill-returned" });
  expect(browserEnds).toEqual(["failed: net::ERR_ABORTED"]);
  // Only now, with every side of the late request ended, the browser makes nothing of it.
  await expect(page.getByTestId("tutor-question")).toHaveCount(0);
  await expect(page.getByTestId("tutor-continue")).toHaveCount(0);
  await expect(rating(page)).toHaveCount(0);
  expect(await page.getByTestId("tutor-panel").textContent()).not.toContain("SPÄTE ANTWORT");
  expect(calls.filter((call) => call.kind === "dialog" && call.answer === "SPÄTE ANTWORT")).toHaveLength(1);

  // The new context starts cleanly: its first question comes from a fresh request.
  const questionCalls = calls.filter((call) => call.kind === "question").length;
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question")).toBeVisible();
  expect(calls.filter((call) => call.kind === "question")).toHaveLength(questionCalls + 1);
  await expect(rating(page)).toHaveCount(0);
});

test("LC-03: Clear and DEBUG off/on end the capture epoch; a late result adds no step; a fresh request is captured completely", async ({ page }) => {
  test.setTimeout(120_000);
  await toPrediction(page);
  const reviewSteps = async () => (await copiedReview(page)).record.steps;

  // Request -> Clear -> late response.
  rate = (_answer, question) => question === IT064_CONCEPT_QUESTION ? { rating: 5, feedback: "Ja." } : { rating: 3, feedback: "Spät, aber da.", mermaid: GRAPHIC };
  const late = holdAnswer("ANTWORT NACH CLEAR");
  await send(page, "ANTWORT NACH CLEAR");
  await late.started;
  await showDebug(page);
  await page.getByRole("button", { name: "Clear debug messages", exact: true }).click();
  late.release();
  // Learning goes on: the answer is shown with its rating...
  await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 3 von 5");
  // ...and "Weiter" works; but the cleared capture gets no step, no graphic event, no completion and no `displayed` step for it.
  await page.getByTestId("tutor-continue").click();
  await expect(page.getByTestId("tutor-continue")).toHaveCount(0);
  await expect(page.getByTestId("tutor-review-panel")).not.toContainText("ANTWORT NACH CLEAR");
  await expect(page.getByTestId("tutor-review-panel")).not.toContainText(/Review steps \(\d+\)/);
  await page.getByLabel("Processing stage", { exact: true }).selectOption("renderer");
  await expect(page.getByText("renderer: rendered", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^(browser|request): (displayed|completed|received)/)).toHaveCount(0);
  await page.getByLabel("Processing stage", { exact: true }).selectOption("");

  // A fresh request in the new epoch is captured completely.
  rate = () => ({ rating: 4, feedback: "Frisch erfasst." });
  const freshCalls = calls.length;
  await send(page, "FRISCHE ANTWORT");
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  expect(calls).toHaveLength(freshCalls + 1);
  const afterClear = await reviewSteps();
  expect(afterClear.filter((step) => step.kind === "answer").map((step) => step.request?.answer)).toEqual(["FRISCHE ANTWORT"]);
  expect(afterClear.filter((step) => step.kind === "answer")[0]?.response?.answerRating).toBe(4);
  expect(afterClear.filter((step) => step.kind === "displayed")).toHaveLength(0);

  // DEBUG off stops the capture; Weiter and a further answer are not recorded.
  await page.keyboard.press("Control+d");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("unoDebugMode"))).toBe("0");
  await page.getByTestId("tutor-continue").click();
  await send(page, "WÄHREND DEBUG AUS");
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  await page.getByTestId("tutor-continue").click();
  // DEBUG on begins a new run: only what follows is in it.
  await page.keyboard.press("Control+d");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("unoDebugMode"))).toBe("1");
  await send(page, "NACH DEBUG EIN");
  await expect(page.getByTestId("tutor-continue")).toBeVisible();
  const afterOn = await reviewSteps();
  expect(afterOn.filter((step) => step.kind === "answer").map((step) => step.request?.answer)).toEqual(["NACH DEBUG EIN"]);
  expect(JSON.stringify(afterOn)).not.toContain("WÄHREND DEBUG AUS");
  expect(JSON.stringify(afterOn)).not.toContain("FRISCHE ANTWORT");
});

test("LC-04: filters and a flooded technical buffer do not shrink the review; the key never appears", async ({ page }) => {
  test.setTimeout(120_000);
  await toPrediction(page);
  rate = () => ({ rating: 2, feedback: `Das Echo ${KEY} ist kein Schlüssel für die Antwort.` });
  for (const text of [`Ich nutze ${KEY} als Antwort`, "7", "2"]) {
    await send(page, text);
    await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 2 von 5");
  }
  await page.evaluate(() => {
    for (let index = 0; index < 600; index++) {
      document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: {
        version: 1, traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
        origin: "frontend", operation: "models", stage: "request", outcome: "started",
      } }));
    }
  });
  await showDebug(page);
  await page.getByLabel("Processing stage", { exact: true }).selectOption("renderer");
  await page.getByLabel("Search debug messages", { exact: true }).fill("no-such-request");
  const { text, record } = await copiedReview(page);
  expect(text).not.toContain(KEY);
  // Every captured request: the question, the focus answer, the learner's answers - 1 + 4 answers, none lost.
  const answers = record.steps.filter((step) => step.kind === "answer");
  expect(answers.map((step) => step.request?.answer === undefined ? "" : step.request.answer.includes("REDACTED") ? "redacted" : step.request.answer)).toEqual([
    "Sie maskiert genau das Bit i.", "redacted", "7", "2",
  ]);
  expect(JSON.stringify(record)).toContain("[REDACTED-CREDENTIAL]");
  // The public classification code stays what it is.
  expect(answers.every((step) => step.response?.learnerInput === "answer")).toBe(true);
});

test("LC-05: an invalid server review block leaves question and rating usable, and the gap visible", async ({ page }) => {
  test.setTimeout(120_000);
  await toPrediction(page);
  corruptReview = true;
  rate = () => ({ rating: 2, feedback: "Noch nicht." });
  await send(page, "7");
  await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 2 von 5");
  await expect(page.getByTestId("tutor-question")).toContainText(plain(IT064_PREDICTION_QUESTION));
  corruptReview = false;
  await send(page, "3");
  await expect(rating(page)).toHaveAttribute("aria-label", "Verständnisbewertung 2 von 5");
  const { record } = await copiedReview(page);
  const answers = record.steps.filter((step) => step.kind === "answer");
  // The step with the invalid block keeps the learner's content and names the gap; the later one is complete.
  const gap = answers.find((step) => step.request?.answer === "7");
  expect(gap?.response?.answerRating).toBe(2);
  expect(gap?.server).toMatchObject({ status: "invalid", entries: [] });
  expect(answers.find((step) => step.request?.answer === "3")?.server).toBeDefined();
});
