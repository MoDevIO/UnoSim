import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";

/** Plan P2.7: the Tutor request carries the board id to the service. */
let server: http.Server | undefined;

async function start(service: object) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "local.test", roles: ["user"] };
    next();
  });
  registerTutorRoutes(app, { service: service as never, disableRateLimit: true, logger: { warn: vi.fn(), error: vi.fn() } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (route: string, body: unknown) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return response.status;
  };
}

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

const serviceStub = () => ({
  generateQuestion: vi.fn().mockResolvedValue({ model: "m", result: { question: "Frage?" } }),
  generateDialogResponse: vi.fn().mockResolvedValue({ model: "m", result: { question: "Weiter?", responseStyle: "normal", answerRating: 3 } }),
});
const sketch = "void setup(){} void loop(){}";
const dialog = { code: sketch, credential: "secret", history: [], question: "Frage?", answer: "Antwort" };

describe("Tutor routes: board", () => {
  it("passes the board of a question request as the last argument", async () => {
    const service = serviceStub();
    const post = await start(service);

    expect(await post("/api/tutor/question", { code: sketch, credential: "secret", board: "mega2560" })).toBe(200);

    expect(service.generateQuestion).toHaveBeenCalledWith(sketch, "secret", undefined, 30, undefined, expect.any(AbortSignal), "mega2560");
  });

  it("passes the board of a dialog request as the last argument", async () => {
    const service = serviceStub();
    const post = await start(service);

    expect(await post("/api/tutor/dialog", { ...dialog, board: "attiny85" })).toBe(200);

    expect(service.generateDialogResponse.mock.calls[0]?.[9]).toBe("attiny85");
  });

  it("calls the service as before when no board is sent", async () => {
    const service = serviceStub();
    const post = await start(service);

    await post("/api/tutor/question", { code: sketch, credential: "secret" });
    await post("/api/tutor/dialog", dialog);

    expect(service.generateQuestion.mock.calls[0]).toHaveLength(6);
    expect(service.generateDialogResponse.mock.calls[0]).toHaveLength(9);
  });

  it("rejects an unknown board before the service is called", async () => {
    const service = serviceStub();
    const post = await start(service);

    expect(await post("/api/tutor/question", { code: sketch, credential: "secret", board: "esp32" })).toBe(400);
    expect(await post("/api/tutor/dialog", { ...dialog, board: "esp32" })).toBe(400);

    expect(service.generateQuestion).not.toHaveBeenCalled();
    expect(service.generateDialogResponse).not.toHaveBeenCalled();
  });
});

describe("Tutor routes: project files", () => {
  it("passes board, headers and entry file together as the last argument", async () => {
    const service = serviceStub();
    const post = await start(service);
    const headers = [{ name: "leds.h", content: "const int LED = 9;" }];

    expect(await post("/api/tutor/question", { code: sketch, credential: "secret", board: "nano", headers, entryFile: "blink.ino" })).toBe(200);
    expect(await post("/api/tutor/dialog", { ...dialog, headers })).toBe(200);

    expect(service.generateQuestion.mock.calls[0]?.[6]).toEqual({ board: "nano", headers, entryFile: "blink.ino" });
    expect(service.generateDialogResponse.mock.calls[0]?.[9]).toEqual({ headers });
  });

  it("rejects a header that would replace the entry file", async () => {
    const service = serviceStub();
    const post = await start(service);

    expect(await post("/api/tutor/question", { code: sketch, credential: "secret", headers: [{ name: "sketch.ino", content: "" }] })).toBe(400);
    expect(service.generateQuestion).not.toHaveBeenCalled();
  });
});
