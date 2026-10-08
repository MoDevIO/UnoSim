import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../server/config";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { TutorProviderError } from "../../../server/services/tutor/llm-provider";
import { prepareTutorCourseContentSession, TutorCourseContentSessionStore } from "../../../server/services/course-content/course-content-session";
import { TutorService } from "../../../server/services/tutor/tutor-service";

function listen(app: express.Express): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

async function post(url: string, route: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const target = new URL(route, url);
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...extraHeaders },
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

  function start(service: object, trustProxy = false, courseContent?: object) {
    const app = express();
    if (trustProxy) app.set("trust proxy", true);
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.unosimIdentity = { subject: "local.test", roles: ["user"] };
      next();
    });
    registerTutorRoutes(app, {
      service: service as never,
      disableRateLimit: true,
      logger: { warn: vi.fn(), error: vi.fn() },
      courseContent: courseContent as never,
    });
    return listen(app);
  }

  it("keeps the internal follow-up provenance out of the public HTTP response (R-FUP-3)", async () => {
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        followUpSource: "planner",
        result: { question: "Welche Zustandsänderung erwartest du?" },
      }),
      generateDialogResponse: vi.fn().mockResolvedValue({
        model: "pilot-model",
        followUpSource: "application-fallback",
        result: { question: "Was ändert sich?", responseStyle: "normal", answerRating: 3 },
      }),
    };
    const listening = await start(service);
    server = listening.server;

    const question = await post(listening.url, "/api/tutor/question", { code: "void setup(){} void loop(){}", credential: "secret" });
    const dialog = await post(listening.url, "/api/tutor/dialog", {
      code: "void setup(){} void loop(){}", credential: "secret", history: [], question: "Frage?", answer: "Antwort",
    });

    expect(JSON.stringify(question.body)).not.toContain("followUpSource");
    expect(JSON.stringify(dialog.body)).not.toContain("followUpSource");
    expect(dialog.status).toBe(200);
  });

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
      model: "pilot-model",
    });
    expect(JSON.stringify(response.body)).not.toContain("request-only-secret");
    expect(service.generateQuestion).toHaveBeenCalledWith(
      "void setup(){} void loop(){}",
      "request-only-secret",
      undefined,
      30,
      undefined,
      expect.any(AbortSignal),
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
    expect(service.getAvailableModels).toHaveBeenCalledWith("request-only-secret", expect.any(AbortSignal));
  });

  it("requires a personal credential for model discovery", async () => {
    const service = { getAvailableModels: vi.fn() };
    const listening = await start(service);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/models", {});

    expect(response).toEqual({
      status: 400,
      body: { error: { code: "CREDENTIAL_REQUIRED", message: expect.any(String) } },
    });
    expect(service.getAvailableModels).not.toHaveBeenCalled();
  });

  it("rejects a personal credential over non-loopback HTTP", async () => {
    const service = { getAvailableModels: vi.fn() };
    const listening = await start(service, true);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/models", { credential: "request-only-secret" }, {
      "x-forwarded-for": "203.0.113.10",
    });

    expect(response).toEqual({
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: expect.any(String) } },
    });
    expect(service.getAvailableModels).not.toHaveBeenCalled();
  });

  it("accepts a personal credential over HTTPS through a trusted proxy", async () => {
    const service = { getAvailableModels: vi.fn().mockResolvedValue(["pilot-model"]) };
    const listening = await start(service, true);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/models", { credential: "request-only-secret" }, {
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
    });

    expect(response).toEqual({ status: 200, body: { models: ["pilot-model"] } });
    expect(service.getAvailableModels).toHaveBeenCalledWith("request-only-secret", expect.any(AbortSignal));
  });

  it("accepts a personal credential over HTTP in the Docker test gateway bypass profile", async () => {
    const service = { getAvailableModels: vi.fn().mockResolvedValue(["pilot-model"]) };
    const originalBypass = config.dockerTestBypassGateway;
    config.dockerTestBypassGateway = true;
    try {
      const listening = await start(service, true);
      server = listening.server;
      const response = await post(listening.url, "/api/tutor/models", { credential: "request-only-secret" }, {
        "x-forwarded-for": "203.0.113.10",
      });

      expect(response).toEqual({ status: 200, body: { models: ["pilot-model"] } });
      expect(service.getAvailableModels).toHaveBeenCalledWith("request-only-secret", expect.any(AbortSignal));
    } finally {
      config.dockerTestBypassGateway = originalBypass;
    }
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
      undefined,
      expect.any(AbortSignal),
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

  it("derives a Course Content session and pins follow-up requests to its revision", async () => {
    const contentA = {
      repository: "owner/repo" as const,
      ref: "main" as const,
      revision: "a".repeat(40),
      exampleId: "arrays-example",
      tutor: { status: "invalid" as const, reason: "invalid-tutor-bundle" },
      contentBytes: 4_096,
    };
    const resolver = {
      resolveTutorContent: vi.fn().mockResolvedValue(contentA),
      getTutorContent: vi.fn(),
    };
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage A" } }),
      generateDialogResponse: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage B" } }),
    };
    const listening = await start(service, false, resolver);
    server = listening.server;
    const context = {
      repository: "owner/repo",
      ref: "main",
      revision: "a".repeat(40),
      exampleId: "arrays-example",
    };
    const first = await post(listening.url, "/api/tutor/question", {
      code: "void setup(){}", credential: "request-only-secret", courseContent: context,
    });
    expect(first.status).toBe(200);
    const session = (first.body as { courseContentSession: string }).courseContentSession;
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.generateQuestion).toHaveBeenCalledWith(
      "void setup(){}", "request-only-secret", undefined, 30, expect.objectContaining(contentA), expect.any(AbortSignal),
    );

    const second = await post(listening.url, "/api/tutor/dialog", {
      code: "void setup(){}",
      history: [],
      question: "Frage A",
      answer: "Antwort",
      credential: "request-only-secret",
      courseContentSession: session,
    });
    expect(second.status).toBe(200);
    expect(service.generateDialogResponse).toHaveBeenCalledWith(
      "void setup(){}", [], "Frage A", "Antwort",
      "request-only-secret", undefined, 30, expect.objectContaining(contentA), expect.any(AbortSignal),
    );
    expect(resolver.resolveTutorContent).toHaveBeenCalledOnce();
  });

  it("rejects a browser revision that does not match server resolution", async () => {
    const resolver = { resolveTutorContent: vi.fn().mockRejectedValue(new Error("revision mismatch")), getTutorContent: vi.fn() };
    const service = { generateQuestion: vi.fn() };
    const listening = await start(service, false, resolver);
    server = listening.server;
    const response = await post(listening.url, "/api/tutor/question", {
      code: "void setup(){}",
      credential: "request-only-secret",
      courseContent: { repository: "owner/repo", ref: "main", revision: "b".repeat(40) },
    });
    expect(response.status).toBe(400);
    expect(service.generateQuestion).not.toHaveBeenCalled();
  });

  it("aborts the shared route and Course Content signal when the client disconnects", async () => {
    const content = {
      repository: "owner/repo" as const,
      ref: "main" as const,
      revision: "c".repeat(40),
      tutor: { status: "absent" as const },
    };
    let resolveGeneration: ((value: unknown) => void) | undefined;
    const service = {
      generateQuestion: vi.fn((
        _code: string,
        _credential: string,
        _model: string | undefined,
        _difficulty: number,
        _content: unknown,
        _signal?: AbortSignal,
      ) => new Promise((resolve) => { resolveGeneration = resolve; })),
    };
    const resolver = { resolveTutorContent: vi.fn().mockResolvedValue(content) };
    const listening = await start(service, false, resolver);
    server = listening.server;
    const target = new URL("/api/tutor/question", listening.url);
    const payload = JSON.stringify({
      code: "void setup(){}",
      credential: "request-only-secret",
      courseContent: { repository: "owner/repo", ref: "main", revision: "c".repeat(40) },
    });
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, () => undefined);
    request.on("error", () => undefined);
    request.end(payload);

    try {
      await vi.waitFor(() => expect(service.generateQuestion).toHaveBeenCalledOnce());
      const signal = service.generateQuestion.mock.calls[0]?.[5];
      request.destroy();
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      expect(resolver.resolveTutorContent.mock.calls[0]?.[1].signal).toBe(signal);
    } finally {
      request.destroy();
      resolveGeneration?.({ model: "pilot-model", result: { question: "Frage" } });
    }
  });
});

describe("Tutor Course Content session lifecycle", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
  });

  const revision = "d".repeat(40);
  const courseContent = { repository: "owner/repo", ref: "main", revision };
  const resolved = { ...courseContent, tutor: { status: "absent" as const }, contentBytes: 2_048 };
  const sessionLimits = { ttlMs: 60_000, maxSessions: 50, maxSessionsPerSubject: 3, maxPinnedContentBytes: 1_048_576 };

  async function startSessions(
    service: object,
    options: { resolver?: object; store?: TutorCourseContentSessionStore; withIdentity?: boolean } = {},
  ) {
    const store = options.store ?? new TutorCourseContentSessionStore(sessionLimits);
    const resolver = options.resolver ?? { resolveTutorContent: vi.fn().mockResolvedValue(resolved) };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      if (options.withIdentity !== false) {
        res.locals.unosimIdentity = { subject: req.header("x-test-subject") ?? "local.learner-a", roles: ["user"] };
      }
      next();
    });
    registerTutorRoutes(app, {
      service: service as never,
      disableRateLimit: true,
      logger: { warn: vi.fn(), error: vi.fn() },
      courseContent: resolver as never,
      sessionStore: store,
    });
    const listening = await listen(app);
    server = listening.server;
    return { url: listening.url, store, resolver };
  }

  const questionBody = { code: "void setup(){}", credential: "request-only-secret", courseContent };
  const dialogBody = (session: string) => ({
    code: "void setup(){}", history: [], question: "Frage?", answer: "Antwort", credential: "request-only-secret", courseContentSession: session,
  });

  it("creates no session for a provider-free dialog fallback but keeps an existing handle usable", async () => {
    const provider = {
      listModels: vi.fn().mockRejectedValue(new TutorProviderError("credential-invalid")),
      generateLearningQuestion: vi.fn().mockRejectedValue(new TutorProviderError("credential-invalid")),
    };
    const { url, store } = await startSessions(new TutorService(provider));
    const nonsense = { code: "void setup(){}", history: [], question: "Frage?", answer: "???!!!", credential: "not-a-valid-key" };

    const fresh = await post(url, "/api/tutor/dialog", { ...nonsense, courseContent });

    expect(fresh.status).toBe(200);
    expect(fresh.body).not.toHaveProperty("courseContentSession");
    expect(provider.generateLearningQuestion).not.toHaveBeenCalled();
    expect(store.stats()).toMatchObject({ sessions: 0, pinnedRevisions: 0 });

    const existing = store.commit("local.learner-a", prepareTutorCourseContentSession(resolved));
    const followUp = await post(url, "/api/tutor/dialog", { ...nonsense, courseContentSession: existing });

    expect(followUp).toMatchObject({ status: 200, body: { courseContentSession: existing } });
    expect(store.stats()).toMatchObject({ sessions: 1 });
  });

  it("commits one session only after a successful request and passes its progression state to the provider call", async () => {
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage?" } }),
      generateDialogResponse: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Weiter?" } }),
    };
    const { url, store } = await startSessions(service);

    const first = await post(url, "/api/tutor/question", questionBody);
    const session = (first.body as { courseContentSession: string }).courseContentSession;
    const second = await post(url, "/api/tutor/dialog", dialogBody(session));

    expect([first.status, second.status]).toEqual([200, 200]);
    expect((second.body as { courseContentSession: string }).courseContentSession).toBe(session);
    expect(store.stats()).toMatchObject({ sessions: 1, subjects: 1, pinnedRevisions: 1, pinnedContentBytes: 2_048 });
    const initialState = service.generateQuestion.mock.calls[0]?.[4]?.progressionState;
    expect(initialState).toEqual(expect.objectContaining({ revision }));
    // The initial question's progression is the session's progression, not a discarded copy.
    expect(service.generateDialogResponse.mock.calls[0]?.[7]?.progressionState).toBe(initialState);
  });

  it.each([
    ["provider-timeout", 504],
    ["credential-invalid", 401],
    ["rate-limited", 429],
    ["model-unavailable", 502],
    ["invalid-response", 502],
    ["provider-unavailable", 502],
  ] as const)("leaves no session behind when the provider fails with %s", async (kind, status) => {
    const service = { generateQuestion: vi.fn().mockRejectedValue(new TutorProviderError(kind)) };
    const { url, store, resolver } = await startSessions(service);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await post(url, "/api/tutor/question", questionBody);
      expect(response.status).toBe(status);
      expect(response.body).not.toHaveProperty("courseContentSession");
    }

    expect((resolver as { resolveTutorContent: ReturnType<typeof vi.fn> }).resolveTutorContent).toHaveBeenCalledTimes(10);
    expect(store.stats()).toMatchObject({ sessions: 0, pinnedRevisions: 0, pinnedContentBytes: 0 });
  });

  it("leaves no session behind for unexpected failures, invalid Course Content, or a missing credential", async () => {
    const service = { generateQuestion: vi.fn().mockRejectedValue(new Error("socket hang up")) };
    const rejecting = { resolveTutorContent: vi.fn().mockRejectedValueOnce(new Error("revision mismatch")).mockResolvedValue(resolved) };
    const { url, store } = await startSessions(service, { resolver: rejecting });

    const invalidContent = await post(url, "/api/tutor/question", questionBody);
    const unexpected = await post(url, "/api/tutor/question", questionBody);
    const noCredential = await post(url, "/api/tutor/question", { ...questionBody, credential: "" });

    expect([invalidContent.status, unexpected.status, noCredential.status]).toEqual([400, 500, 400]);
    expect(rejecting.resolveTutorContent).toHaveBeenCalledTimes(2);
    expect(store.stats().sessions).toBe(0);
  });

  it("leaves no session behind when the client disconnects before the provider answers", async () => {
    let finishGeneration: ((value: unknown) => void) | undefined;
    const generation = new Promise((resolve) => { finishGeneration = resolve; });
    const service = { generateQuestion: vi.fn(() => generation) };
    const { url, store } = await startSessions(service);
    const target = new URL("/api/tutor/question", url);
    const payload = JSON.stringify(questionBody);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, () => undefined);
    request.on("error", () => undefined);
    request.end(payload);

    await vi.waitFor(() => expect(service.generateQuestion).toHaveBeenCalledOnce());
    const signal = (service.generateQuestion.mock.calls[0] as unknown[])[5] as AbortSignal;
    request.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    // Worst case: the provider still answers after the disconnect.
    finishGeneration?.({ model: "pilot-model", result: { question: "Frage?" } });
    await generation;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(store.stats().sessions).toBe(0);
  });

  it("rejects a session handle owned by another subject without touching its progression", async () => {
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage?" } }),
      generateDialogResponse: vi.fn(),
    };
    const { url, store } = await startSessions(service);
    const first = await post(url, "/api/tutor/question", questionBody);
    const session = (first.body as { courseContentSession: string }).courseContentSession;

    const foreign = await post(url, "/api/tutor/dialog", dialogBody(session), { "x-test-subject": "local.learner-b" });

    expect(foreign).toEqual({ status: 400, body: { error: { code: "INVALID_REQUEST", message: "Der Tutor-Kontext ist abgelaufen oder ungültig." } } });
    expect(service.generateDialogResponse).not.toHaveBeenCalled();
    expect(store.get("local.learner-a", session)).not.toBeNull();
    expect(store.stats().subjects).toBe(1);
  });

  it("rejects an expired session handle with the existing context error", async () => {
    let now = 1_000;
    const store = new TutorCourseContentSessionStore(sessionLimits, () => now);
    const service = {
      generateQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage?" } }),
      generateDialogResponse: vi.fn(),
    };
    const { url } = await startSessions(service, { store });
    const first = await post(url, "/api/tutor/question", questionBody);
    now += sessionLimits.ttlMs;

    const expired = await post(url, "/api/tutor/dialog", dialogBody((first.body as { courseContentSession: string }).courseContentSession));

    expect(expired.status).toBe(400);
    expect((expired.body as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    expect(service.generateDialogResponse).not.toHaveBeenCalled();
    expect(store.stats()).toMatchObject({ sessions: 0, expired: 1 });
  });

  it("bounds the sessions of repeated questions without a handle per subject", async () => {
    const service = { generateQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Frage?" } }) };
    const { url, store } = await startSessions(service);

    const handles: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await post(url, "/api/tutor/question", questionBody);
      handles.push((response.body as { courseContentSession: string }).courseContentSession);
    }
    const other = await post(url, "/api/tutor/question", questionBody, { "x-test-subject": "local.learner-b" });

    expect(new Set(handles).size).toBe(12);
    expect(other.status).toBe(200);
    expect(store.stats()).toMatchObject({ sessions: 4, subjects: 2, evicted: { "subject-limit": 9 } });
    expect(handles.slice(-3).every((handle) => store.get("local.learner-a", handle) !== null)).toBe(true);
  });

  it("refuses Course Content without an authenticated subject instead of sharing an anonymous owner", async () => {
    const service = { generateQuestion: vi.fn() };
    const { url, store, resolver } = await startSessions(service, { withIdentity: false });

    const response = await post(url, "/api/tutor/question", questionBody);

    expect(response.status).toBe(500);
    expect((resolver as { resolveTutorContent: ReturnType<typeof vi.fn> }).resolveTutorContent).not.toHaveBeenCalled();
    expect(service.generateQuestion).not.toHaveBeenCalled();
    expect(store.stats().sessions).toBe(0);
  });
});
