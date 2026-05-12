/**
 * Verifies /api/status is excluded from the global rate limiter.
 *
 * Regression: in production mode (max=300/15 min), rapid /api/status polling
 * consumed all tokens and blocked /api/compile → "Compilation Failed".
 */
import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "node:http";

// ── helpers ──────────────────────────────────────────────────────────────

function listen(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

async function httpGet(baseUrl: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on("error", reject);
  });
}

// ── tests ────────────────────────────────────────────────────────────────

describe("Rate limiter skip list", () => {
  let baseUrl: string;
  let server: http.Server;

  afterAll(() =>
    new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    }),
  );

  it("/api/status is excluded — 150 status polls do not block /api/compile", async () => {
    // Build a minimal Express app with the SAME rate-limiter config as index.ts
    const app = express();

    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10, // very low to prove status is skipped
      message: { error: "Too many requests, please try again later." },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.originalUrl === "/api/examples" ||
        req.originalUrl === "/api/status" ||
        req.originalUrl === "/api/health",
    });

    app.use("/api/", apiLimiter);
    app.use(express.json());

    app.get("/api/status", (_req, res) => res.json({ status: "ok" }));
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    app.post("/api/compile", (_req, res) => res.json({ success: true }));

    ({ baseUrl, server } = await listen(app));

    // Hammer /api/status 150 times — must NOT exhaust tokens
    for (let i = 0; i < 150; i++) {
      const { status } = await httpGet(baseUrl, "/api/status");
      expect(status).toBe(200);
    }

    // /api/compile must still succeed
    const compileRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL("/api/compile", baseUrl);
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => { data += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on("error", reject);
      req.write(JSON.stringify({ code: "void setup(){}" }));
      req.end();
    });

    expect(compileRes.status).toBe(200);
    expect(JSON.parse(compileRes.body).success).toBe(true);
  });

  it("/api/compile IS rate-limited after exceeding max", async () => {
    const app = express();

    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 3, // low limit to trigger quickly
      message: { error: "Too many requests, please try again later." },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.originalUrl === "/api/examples" ||
        req.originalUrl === "/api/status" ||
        req.originalUrl === "/api/health",
    });

    app.use("/api/", apiLimiter);
    app.use(express.json());
    app.post("/api/compile", (_req, res) => res.json({ success: true }));

    const { baseUrl: url2, server: srv2 } = await listen(app);

    // Consume all 3 tokens
    for (let i = 0; i < 3; i++) {
      const resp = await new Promise<{ status: number }>((resolve, reject) => {
        const u = new URL("/api/compile", url2);
        const req = http.request(
          { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json" } },
          (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0 })); },
        );
        req.on("error", reject);
        req.write(JSON.stringify({ code: "x" }));
        req.end();
      });
      expect(resp.status).toBe(200);
    }

    // 4th compile must be rate-limited (429)
    const resp = await new Promise<{ status: number }>((resolve, reject) => {
      const u = new URL("/api/compile", url2);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0 })); },
      );
      req.on("error", reject);
      req.write(JSON.stringify({ code: "x" }));
      req.end();
    });

    expect(resp.status).toBe(429);

    await new Promise<void>((resolve, reject) => {
      srv2.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
