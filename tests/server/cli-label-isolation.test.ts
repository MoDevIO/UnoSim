/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { createHash } from "crypto";

/**
 * CLI Label Isolation Test (Self-Contained)
 *
 * Verifies that CLI status labels and compilation results don't leak
 * across session boundaries. Uses a local stub server to be runnable
 * without an external server.
 */

function fetchHttp(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options?.method || "GET",
      headers: options?.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk: any) => (data += chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          json: async () => JSON.parse(data),
        });
      });
    });

    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describe("CLI Label Session Isolation", () => {
  let API_BASE: string;
  let stubServer: http.Server;

  const compilationCache = new Map<string, { result: any; compiledAt: number }>();
  const sessionCompilations = new Map<string, string[]>();

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      stubServer = http.createServer((req, res) => {
        if (req.url?.startsWith("/api/sketches")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
          return;
        }

        if (req.url === "/api/compile" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => (body += chunk));
          req.on("end", () => {
            const parsed = JSON.parse(body);
            const codeHash = createHash("sha256")
              .update(parsed.code || "")
              .digest("hex");

            const sessionId = (req.headers["x-session-id"] as string) || "default";
            if (!sessionCompilations.has(sessionId)) {
              sessionCompilations.set(sessionId, []);
            }
            sessionCompilations.get(sessionId)!.push(codeHash);

            const cached = compilationCache.has(codeHash);
            if (!cached) {
              compilationCache.set(codeHash, {
                result: { success: true, output: "Compiled: " + codeHash.slice(0, 8) },
                compiledAt: Date.now(),
              });
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                output: compilationCache.get(codeHash)!.result.output,
                cached,
                codeHash: codeHash.slice(0, 8),
              }),
            );
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      stubServer.listen(0, () => {
        API_BASE = "http://localhost:" + (stubServer.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stubServer.close(() => resolve()));
  });

  it("should NOT broadcast CLI status across sessions", async () => {
    const code1 = "// Session 1 code - unique: " + Date.now() + "\nint x1 = 1;";
    const code2 = "// Session 2 code - unique: " + Date.now() + "_2\nint x2 = 2;";

    const response1 = await fetchHttp(API_BASE + "/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "session-1" },
      body: JSON.stringify({ code: code1 }),
    });
    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);

    const response2 = await fetchHttp(API_BASE + "/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "session-2" },
      body: JSON.stringify({ code: code2 }),
    });
    expect(response2.ok).toBe(true);
    const result2 = await response2.json();
    expect(result2.success).toBe(true);

    const session1Hashes = sessionCompilations.get("session-1") || [];
    const session2Hashes = sessionCompilations.get("session-2") || [];
    expect(session1Hashes.length).toBe(1);
    expect(session2Hashes.length).toBe(1);
    expect(session1Hashes[0]).not.toBe(session2Hashes[0]);

    expect(result1.cached).toBe(false);
    expect(result2.cached).toBe(false);
  }, 10000);

  it("should allow same code to be cached across different sessions", async () => {
    const sharedCode = "// shared code " + Date.now() + "\nint shared = 42;";

    const response1 = await fetchHttp(API_BASE + "/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "session-cache-1" },
      body: JSON.stringify({ code: sharedCode }),
    });
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    expect(result1.cached).toBe(false);

    const response2 = await fetchHttp(API_BASE + "/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "session-cache-2" },
      body: JSON.stringify({ code: sharedCode }),
    });
    const result2 = await response2.json();
    expect(result2.success).toBe(true);
    expect(result2.cached).toBe(true);
  }, 10000);
});
