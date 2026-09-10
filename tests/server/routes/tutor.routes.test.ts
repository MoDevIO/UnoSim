import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { TutorProviderError } from "../../../server/services/tutor/llm-provider";

vi.mock("../../../server/config", async () => {
  const actual = await vi.importActual<typeof import("../../../server/config")>("../../../server/config");
  return {
    ...actual,
    config: {
      ...actual.config,
      tutor: { ...actual.config.tutor, mode: "user-key" },
    },
  };
});

function listen(app: express.Express): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

async function post(url: string, route: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const target = new URL(route, url);
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

describe("Tutor HTTP route", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  });

  function start(service: object) {
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.unosimIdentity = { subject: "local.test", roles: ["user"] };
      next();
    });
    registerTutorRoutes(app, {
      service: service as never,
      disableRateLimit: true,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    return listen(app);
  }

  it("returns the validated question and never echoes the request credential", async () => {
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: { question: "Welche Zustandsänderung erwartest du?" },
      }),
    };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/question", {
      code: "void setup(){} void loop(){}",
      credential: "request-only-secret",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      question: "Welche Zustandsänderung erwartest du?",
      provider: "kiconnect",
      mode: "user-key",
      model: "pilot-model",
    });
    expect(JSON.stringify(response.body)).not.toContain("request-only-secret");
    expect(service.generateQuestion).toHaveBeenCalledWith(
      "void setup(){} void loop(){}",
      "request-only-secret",
      undefined,
      30,
    );
  });

  it("rejects a missing credential before invoking the provider service", async () => {
    const service = { generateQuestion: vi.fn() };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/question", { code: "void setup(){}" });

    expect(response).toEqual({
      status: 400,
      body: { error: { code: "CREDENTIAL_REQUIRED", message: expect.any(String) } },
    });
    expect(service.generateQuestion).not.toHaveBeenCalled();
  });

  it("maps provider errors to stable safe error contracts", async () => {
    const service = {
      generateQuestion: vi.fn().mockRejectedValue(new TutorProviderError("provider-timeout")),
    };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/question", { code: "void setup(){}", credential: "request-only-secret" });

    expect(response).toEqual({
      status: 504,
      body: { error: { code: "PROVIDER_TIMEOUT", message: expect.any(String) } },
    });
  });

  it("returns only the current provider model list", async () => {
    const service = {
      getAvailableModels: vi.fn().mockResolvedValue(["current-model", "another-model"]),
    };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/models", { credential: "request-only-secret" });

    expect(response).toEqual({ status: 200, body: { models: ["current-model", "another-model"] } });
    expect(service.getAvailableModels).toHaveBeenCalledWith("request-only-secret");
  });

  it("accepts a dialog answer and returns feedback plus exactly one follow-up question", async () => {
    const service = {
      generateDialogResponse: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          feedback: "Gute Beobachtung.",
          question: "Was würdest du als Nächstes messen?",
        },
      }),
    };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/dialog", {
      code: "void setup(){} void loop(){}",
      history: [{ question: "Was siehst du?", answer: "Eine Ausgabe." }],
      question: "Was siehst du?",
      answer: "Eine Ausgabe.",
      credential: "request-only-secret",
    });

    expect(response).toEqual({
      status: 200,
      body: {
        feedback: "Gute Beobachtung.",
        question: "Was würdest du als Nächstes messen?",
        provider: "kiconnect",
        mode: "user-key",
        model: "pilot-model",
      },
    });
    expect(service.generateDialogResponse).toHaveBeenCalledWith(
      "void setup(){} void loop(){}",
      [{ question: "Was siehst du?", answer: "Eine Ausgabe.", responseStyle: "normal" }],
      "Was siehst du?",
      "Eine Ausgabe.",
      "request-only-secret",
      undefined,
      30,
    );
  });

  it("rejects malformed dialog history before invoking the service", async () => {
    const service = { generateDialogResponse: vi.fn() };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/dialog", {
      code: "void setup(){}",
      history: [{ question: "Frage", answer: "" }],
      answer: "Antwort",
      credential: "request-only-secret",
    });

    expect(response.status).toBe(400);
    expect(service.generateDialogResponse).not.toHaveBeenCalled();
  });
});
