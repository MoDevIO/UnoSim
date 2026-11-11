import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../server/config";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { KiconnectProvider } from "../../../server/services/tutor/kiconnect-provider";
import { TUTOR_PROMPT_REVISION, TUTOR_SYSTEM_PROMPT, TutorService } from "../../../server/services/tutor/tutor-service";
import { getTutorReview, reportTutorReview, withTutorDiagnostics } from "../../../server/services/tutor/tutor-diagnostics";
import { tutorDiagnosticEnvelopeSchema } from "../../../shared/tutor-diagnostics";
import { TUTOR_REVIEW_LIMITS, tutorReviewEnvelopeSchema } from "../../../shared/tutor-review";
import { TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "../../../shared/tutor-assessment-guidance";

/** The server's `review` block (LearningQuestions 12.7) through the real provider parser and HTTP routes. */
const code = "const int led = 13;\nvoid setup() { pinMode(led, OUTPUT); }\nvoid loop() { digitalWrite(led, HIGH); }";
const credential = "PRIVATE-REVIEW-ROUTE-KEY-0123456789";
const mermaid = "flowchart LR\n  A[setup] --> B[loop]";
const previous = { diagnostics: config.tutor.diagnosticsEnabled, autoModels: config.tutor.autoModels };
let server: http.Server | undefined;
let providerCalls = 0;

afterEach(async () => {
  config.tutor.diagnosticsEnabled = previous.diagnostics;
  (config.tutor as { autoModels: readonly string[] }).autoModels = previous.autoModels;
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function setup(content: Record<string, unknown>) {
  config.tutor.diagnosticsEnabled = true;
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["listed-model"];
  providerCalls = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "listed-model" }] }), { status: 200 });
    providerCalls++;
    return new Response(JSON.stringify({ model: "listed-model", choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "local.test", roles: ["user"] }; next(); });
  registerTutorRoutes(app, { service: new TutorService(new KiconnectProvider()), disableRateLimit: true });
  const port = await new Promise<number>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
    server.once("error", reject);
  });
  return (path: string, body: unknown, debug = true) => new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...(debug ? { "x-unosim-tutor-debug": "1", "x-request-id": randomUUID() } : {}) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

describe("Tutor review block", () => {
  it("adds the normalized draft, facts and outcome with the prompt revision, redacted and without prompt sources", async () => {
    const post = await setup({ responseStyle: "normal", question: "Welche Aufgabe hat pinMode in setup?", feedback: `Dein Schlüssel ${credential} gehört nicht hierher.`, mermaid });
    const result = await post("/api/tutor/question", { code, credential, model: "listed-model" });
    expect(result.status).toBe(200);
    const review = tutorReviewEnvelopeSchema.parse(result.body.review);
    const diagnostics = tutorDiagnosticEnvelopeSchema.parse(result.body.diagnostics);
    expect(review).toMatchObject({ traceId: diagnostics.traceId, requestId: diagnostics.requestId, operation: "question" });
    expect(review.promptRevision).toEqual({ id: TUTOR_PROMPT_REVISION.id, templateDigest: TUTOR_PROMPT_REVISION.templateDigest });
    // The rules the answer was rated with travel with the request, so a later revision cannot rewrite them.
    expect(review.guidance).toEqual({ ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE });
    expect(review.entries.find((entry) => entry.kind === "draft")).toMatchObject({ attempt: 1, question: "Welche Aufgabe hat pinMode in setup?", mermaid });
    expect(review.entries.find((entry) => entry.kind === "facts")?.json).toContain("pinMode");
    expect(review.entries.find((entry) => entry.kind === "outcome")).toMatchObject({ followUpSource: "provider", graphic: "kept" });
    expect(review.sanitized).toBeGreaterThanOrEqual(1);
    const raw = JSON.stringify(result.body.review);
    expect(raw).not.toContain(credential);
    expect(raw).not.toContain(TUTOR_SYSTEM_PROMPT.slice(0, 60));
    expect(raw).not.toContain("sources");
    // The code itself is not mirrored back; only the deterministic facts derived from it.
    expect(raw).not.toContain("digitalWrite(led, HIGH); }");
  });

  it("names a repeated follow-up that the application replaced", async () => {
    const asked = "Welche Aufgabe hat pinMode in setup?";
    const post = await setup({ responseStyle: "normal", question: asked, feedback: "Richtig.", answerRating: 5 });
    const result = await post("/api/tutor/dialog", { code, credential, model: "listed-model", history: [], question: asked, answer: "Es setzt den Pin als Ausgang." });
    expect(result.status).toBe(200);
    const review = tutorReviewEnvelopeSchema.parse(result.body.review);
    const decision = review.entries.find((entry) => entry.kind === "decision");
    expect(decision).toMatchObject({ trigger: "repetition-fallback", before: asked });
    expect(review.entries.find((entry) => entry.kind === "outcome")).toMatchObject({ question: result.body.question });
    expect(result.body.question).not.toBe(asked);
  });

  it("follows the diagnostics opt-in: no header or disabled server means no review block", async () => {
    const post = await setup({ responseStyle: "normal", question: "Was macht loop?" });
    expect((await post("/api/tutor/question", { code, credential, model: "listed-model" }, false)).body).not.toHaveProperty("review");
    config.tutor.diagnosticsEnabled = false;
    expect((await post("/api/tutor/question", { code, credential, model: "listed-model" })).body).not.toHaveProperty("review");
  });

  it("marks a Support replay without a draft or a new provider call", async () => {
    const post = await setup({ responseStyle: "normal", question: "Was macht loop?", feedback: "Achte auf die Wiederholung." });
    const initial = await post("/api/tutor/question", { code, credential, model: "listed-model", learningSupport: true });
    const body = { code, credential, model: "listed-model", history: [], action: "hint", supportSession: initial.body.support.session, questionHandle: initial.body.support.questionHandle, actionId: randomUUID() };
    const first = await post("/api/tutor/support", body);
    expect(first.status).toBe(200);
    const calls = providerCalls;
    const replay = await post("/api/tutor/support", body);
    expect(providerCalls).toBe(calls);
    const review = tutorReviewEnvelopeSchema.parse(replay.body.review);
    expect(review.entries).toEqual([{ kind: "replay", reason: "support-cache" }]);
    expect(tutorReviewEnvelopeSchema.parse(first.body.review).entries.some((entry) => entry.kind === "draft")).toBe(true);
  });

  it("keeps the block within 128 KiB and counts what it dropped", () => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "answer" }, () => {
      for (let index = 0; index < 80; index++) reportTutorReview({ kind: "draft", attempt: 1, question: "q".repeat(2_000), feedback: "f".repeat(1_000) });
      const review = getTutorReview({ id: "tutor-prompts-v10", templateDigest: "a".repeat(64) })!;
      expect(Buffer.byteLength(JSON.stringify(review))).toBeLessThanOrEqual(TUTOR_REVIEW_LIMITS.serverBlockBytes);
      expect(review.dropped).toBeGreaterThan(0);
      expect(tutorReviewEnvelopeSchema.safeParse(review).success).toBe(true);
    });
  });
});
