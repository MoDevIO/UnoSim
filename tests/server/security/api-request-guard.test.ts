import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { guardApiMutations } from "../../../server/security/api-request-guard";

const servers: http.Server[] = [];

async function startApp() {
  const app = express();
  app.use("/api/", guardApiMutations);
  app.use(express.json());
  app.post("/api/compile", (req, res) => res.json({ received: req.body ?? null }));
  app.get("/api/sketches", (_req, res) => res.json([]));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return (route: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${route}`, init);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("API mutation guard", () => {
  it.each([
    ["application/x-www-form-urlencoded", "code=void+setup(){}"],
    ["text/plain", JSON.stringify({ code: "void setup(){}" })],
    ["multipart/form-data; boundary=x", "--x\r\nContent-Disposition: form-data; name=\"code\"\r\n\r\nx\r\n--x--\r\n"],
  ])("rejects a CORS-simple %s body without reaching the route", async (contentType, body) => {
    const request = await startApp();
    const response = await request("/api/compile", { method: "POST", headers: { "content-type": contentType }, body });
    expect(response.status).toBe(415);
  });

  it.each(["cross-site", "same-site"])("rejects a JSON mutation a browser reports as %s", async (site) => {
    const request = await startApp();
    const response = await request("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": site },
      body: JSON.stringify({ code: "x" }),
    });
    expect(response.status).toBe(403);
  });

  it.each([undefined, "same-origin", "none"])("accepts JSON from fetch site %s", async (site) => {
    const request = await startApp();
    const response = await request("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", ...(site ? { "sec-fetch-site": site } : {}) },
      body: JSON.stringify({ code: "x" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: { code: "x" } });
  });

  it("leaves reads and body-less mutations alone", async () => {
    const request = await startApp();
    expect((await request("/api/sketches", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
    expect((await request("/api/compile", { method: "POST" })).status).toBe(200);
  });
});
