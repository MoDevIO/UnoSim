import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { registerSketchRoutes } from "../../../server/routes/sketches.routes";
import { DefaultSketchStore } from "../../../server/storage";

const servers: http.Server[] = [];

async function startApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.locals.unosimIdentity = { subject: req.header("x-test-subject"), roles: ["user"] };
    next();
  });
  registerSketchRoutes(app, new DefaultSketchStore());
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return async (subject: string, method: string, route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { "content-type": "application/json", "x-test-subject": subject },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { /* express default 404 page */ }
    return { status: response.status, body: parsed };
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("sketch routes are read-only", () => {
  it("serves the shared default sketch to every identity", async () => {
    const request = await startApp();
    const list = await request("alice", "GET", "/api/sketches");
    expect(list.status).toBe(200);
    const seed = (list.body as Array<{ id: string; content: string }>)[0];
    expect(seed.content).toContain("void setup()");
    expect((await request("bob", "GET", `/api/sketches/${seed.id}`)).body).toMatchObject({ content: seed.content });
    expect((await request("bob", "GET", "/api/sketches/missing")).status).toBe(404);
  });

  it("exposes no sketch mutations, so client payloads cannot grow server memory", async () => {
    const request = await startApp();
    const seed = ((await request("alice", "GET", "/api/sketches")).body as Array<{ id: string; content: string }>)[0];
    const largeContent = "x".repeat(512 * 1024);

    for (let index = 0; index < 20; index += 1) {
      expect((await request("alice", "POST", "/api/sketches", { name: `${index}.ino`, content: largeContent })).status).toBe(404);
    }
    expect((await request("alice", "PUT", `/api/sketches/${seed.id}`, { content: "tampered" })).status).toBe(404);
    expect((await request("alice", "DELETE", `/api/sketches/${seed.id}`)).status).toBe(404);

    const after = (await request("bob", "GET", "/api/sketches")).body as Array<{ id: string; content: string }>;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: seed.id, content: seed.content });
  });
});
