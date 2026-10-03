import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { registerSketchRoutes } from "../../../server/routes/sketches.routes";
import { MemStorage, OwnedSketchStore } from "../../../server/storage";

const servers: http.Server[] = [];

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.unosimIdentity = { subject: req.header("x-test-subject"), roles: ["user"] };
    next();
  });
  registerSketchRoutes(app, new OwnedSketchStore(new MemStorage()));
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
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("sketch routes isolate writes per identity", () => {
  it("lets each identity see the shared seed sketch but not change it", async () => {
    const request = await startApp();
    const list = await request("alice", "GET", "/api/sketches");
    expect(list.status).toBe(200);
    const seed = list.body[0] as { id: string; content: string };

    expect((await request("alice", "PUT", `/api/sketches/${seed.id}`, { content: "tampered" })).status).toBe(404);
    expect((await request("alice", "DELETE", `/api/sketches/${seed.id}`)).status).toBe(404);
    expect((await request("bob", "GET", `/api/sketches/${seed.id}`)).body).toMatchObject({ content: seed.content });
  });

  it("keeps a created sketch private to its creator", async () => {
    const request = await startApp();
    const created = await request("alice", "POST", "/api/sketches", { name: "a.ino", content: "void setup(){} void loop(){}" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    expect((await request("bob", "GET", `/api/sketches/${id}`)).status).toBe(404);
    expect((await request("bob", "PUT", `/api/sketches/${id}`, { content: "x" })).status).toBe(404);
    expect((await request("bob", "DELETE", `/api/sketches/${id}`)).status).toBe(404);
    expect((await request("bob", "GET", "/api/sketches")).body.map((sketch: { id: string }) => sketch.id)).not.toContain(id);

    expect((await request("alice", "PUT", `/api/sketches/${id}`, { name: "b.ino" })).body).toMatchObject({ id, name: "b.ino" });
    expect((await request("alice", "GET", "/api/sketches")).body.map((sketch: { id: string }) => sketch.id)).toContain(id);
    expect((await request("alice", "DELETE", `/api/sketches/${id}`)).status).toBe(204);
  });
});
