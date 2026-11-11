import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../../server/config";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { TutorService } from "../../../server/services/tutor/tutor-service";
import { tutorDiagnosticEnvelopeSchema } from "../../../shared/tutor-diagnostics";

const code = "void setup() {} void loop() {}";
const mermaid = "flowchart LR\nA[setup] --> B[loop]";
const credential = "PRIVATE_REQUEST_KEY_SENTINEL";
const previous = config.tutor.diagnosticsEnabled;
let server: http.Server | undefined;
afterEach(async () => {
  config.tutor.diagnosticsEnabled = previous;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function setup() {
  config.tutor.diagnosticsEnabled = true;
  let calls = 0;
  const service = new TutorService({
    async listModels() { return ["model"]; },
    async generateLearningQuestion() {
      calls++;
      return { model: "model", result: { responseStyle: "normal" as const, question: "Welche Reihenfolge erkennst du?", feedback: "Verfolge die beiden Funktionen im Sketch.", mermaid } };
    },
  });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "local.test", roles: ["user"] }; next(); });
  registerTutorRoutes(app, { service, disableRateLimit: true });
  const port = await new Promise<number>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
    server.once("error", reject);
  });
  const post = (path: string, body: unknown, debug = true) => new Promise<{ status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...(debug ? { "x-unosim-tutor-debug": "1", "x-request-id": randomUUID() } : {}) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers }));
    });
    req.on("error", reject);
    req.end(payload);
  });
  return { post, calls: () => calls };
}

describe("Tutor diagnostic HTTP envelopes", () => {
  it("decorates success and validation errors, and honors both opt-in switches", async () => {
    const { post } = await setup();
    const result = await post("/api/tutor/question", { code, credential, model: "model" });
    expect(result.status).toBe(200);
    expect(result.body.mermaid).toBe(mermaid);
    const diagnostics = tutorDiagnosticEnvelopeSchema.parse(result.body.diagnostics);
    expect(diagnostics.events.some((event) => event.stage === "safety" && event.outcome === "accepted")).toBe(true);
    expect(diagnostics.events.at(-1)).toMatchObject({ stage: "request", outcome: "completed", statusCode: 200 });
    expect(JSON.stringify(diagnostics)).not.toContain(credential);
    expect(JSON.stringify(diagnostics)).not.toContain("Welche Reihenfolge");
    expect(JSON.stringify(diagnostics)).not.toContain("flowchart LR");
    expect(result.headers["cache-control"]).toBe("no-store");
    const invalid = await post("/api/tutor/question", { credential });
    expect(invalid.status).toBe(400);
    expect(tutorDiagnosticEnvelopeSchema.parse(invalid.body.diagnostics).events.at(-1)?.outcome).toBe("failed");
    expect((await post("/api/tutor/question", { code, credential }, false)).body).not.toHaveProperty("diagnostics");
    config.tutor.diagnosticsEnabled = false;
    expect((await post("/api/tutor/question", { code, credential })).body).not.toHaveProperty("diagnostics");
  });

  it("builds a fresh diagnostic envelope on Support replay without regenerating", async () => {
    const { post, calls } = await setup();
    const initial = await post("/api/tutor/question", { code, credential, model: "model", learningSupport: true });
    const body = { code, credential, model: "model", history: [], action: "clarify", supportSession: initial.body.support.session, questionHandle: initial.body.support.questionHandle, actionId: randomUUID() };
    const first = await post("/api/tutor/support", body);
    expect(first.status).toBe(200);
    const count = calls();
    const replay = await post("/api/tutor/support", body);
    expect(replay.status).toBe(200);
    expect(calls()).toBe(count);
    expect(replay.body.explanation).toBe(first.body.explanation);
    expect(replay.body.diagnostics.requestId).not.toBe(first.body.diagnostics.requestId);
    const events = tutorDiagnosticEnvelopeSchema.parse(replay.body.diagnostics).events;
    expect(events.some((event) => event.outcome === "replayed" && event.reason === "support-cache")).toBe(true);
    expect(events.some((event) => event.stage === "provider")).toBe(false);
  });
});
