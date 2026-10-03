import express from "express";
import rateLimit from "express-rate-limit";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { apiRateLimitKey } from "../../../server/rate-limit-policy";
import type { TrustConfig } from "../../../server/security/access-control";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const GATEWAY: TrustConfig = { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" };
const servers: http.Server[] = [];

function gatewayHeaders(subject: string, secret = SECRET): Record<string, string> {
  return { "X-UnoSim-Gateway-Secret": secret, "X-UnoSim-Subject": subject, "X-UnoSim-Roles": "user" };
}

async function startApp(trust: TrustConfig) {
  const app = express();
  app.use(rateLimit({
    windowMs: 60_000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => apiRateLimitKey(req, trust),
  }));
  app.get("/api/compile", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return async (headers: Record<string, string> = {}) =>
    (await fetch(`http://127.0.0.1:${port}/api/compile`, { headers })).status;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("global API rate-limit key", () => {
  it("gives every authenticated gateway subject its own budget behind one IP", async () => {
    const request = await startApp(GATEWAY);

    expect([await request(gatewayHeaders("alice")), await request(gatewayHeaders("alice"))]).toEqual([200, 200]);
    expect(await request(gatewayHeaders("alice"))).toBe(429);
    expect([await request(gatewayHeaders("bob")), await request(gatewayHeaders("bob"))]).toEqual([200, 200]);
  });

  it("keeps unauthenticated gateway requests on the IP budget", async () => {
    const request = await startApp(GATEWAY);

    await request(gatewayHeaders("mallory", "wrong-secret-wrong-secret-wrong-secret"));
    await request();
    expect(await request(gatewayHeaders("eve", "another-wrong-secret-another-wrong"))).toBe(429);
  });

  it("keeps local mode on the IP budget", async () => {
    const request = await startApp({ mode: "local" });

    await request();
    await request();
    expect(await request()).toBe(429);
  });
});
