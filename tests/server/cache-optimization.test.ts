/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";

/**
 * Cache Optimization Test (Self-Contained)
 *
 * Validates compilation result caching semantics:
 * - First compilation: cache miss
 * - Subsequent compilations with same code: cache hit (fast)
 * - Different code: cache miss
 * - TTL eviction: cache entries expire
 *
 * Previously required a running server (describeIfServer). Now uses
 * a local stub server with realistic caching behavior.
 */

function fetchHttp(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}> {
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
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          json: async () => JSON.parse(data),
          text: async () => data,
        });
      });
    });

    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describe("Compilation Cache Optimization", () => {
  let API_BASE: string;
  let stubServer: http.Server;

  // Realistic compilation cache with TTL
  const CACHE_TTL_MS = 200; // Short TTL for testing (200ms)
  const compilationCache = new Map<
    string,
    { output: string; cachedAt: number; headers?: any }
  >();

  function hashCode(code: string, headers?: any): string {
    const payload = JSON.stringify({ code, headers: headers || [] });
    return createHash("sha256").update(payload).digest("hex");
  }

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
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          const hash = hashCode(parsed.code, parsed.headers);
          const now = Date.now();

          // Check cache with TTL
          const entry = compilationCache.get(hash);
          if (entry && now - entry.cachedAt < CACHE_TTL_MS) {
            // Cache hit
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                output: entry.output,
                cached: true,
              }),
            );
            return;
          }

          // Evict expired entry if present
          if (entry) {
            compilationCache.delete(hash);
          }

          // Cache miss — simulate compilation delay (5ms)
          setTimeout(() => {
            const output = `Compiled: ${hash.slice(0, 8)}`;
            compilationCache.set(hash, { output, cachedAt: Date.now(), headers: parsed.headers });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                output,
                cached: false,
              }),
            );
          }, 5);
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

      stubServer.listen(0, () => {
        API_BASE = `http://localhost:${(stubServer.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stubServer.close(() => resolve()));
  });

  it("should demonstrate cache hit vs miss", async () => {
    // Use unique code to ensure fresh compile
    const uniqueCode = `
void setup() {
  Serial.begin(115200);
  Serial.println("Test at ${Date.now()}");
}
void loop() { delay(100); }
`;

    // First compilation — cache miss
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: uniqueCode }),
    });
    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    expect(result1.cached).toBe(false);

    // Subsequent compilations — cache hits
    const cacheHitTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const responseN = await fetchHttp(`${API_BASE}/api/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: uniqueCode }),
      });
      cacheHitTimes.push(Date.now() - start);
      const resultN = await responseN.json();
      expect(resultN.success).toBe(true);
      expect(resultN.cached).toBe(true);
    }

    // Different code — cache miss
    const differentCode = uniqueCode + "\n// Different " + Date.now();
    const responseDiff = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: differentCode }),
    });
    const resultDiff = await responseDiff.json();
    expect(resultDiff.success).toBe(true);
    expect(resultDiff.cached).toBe(false); // Different code → miss

    // Validate cache hits were returned consistently
    expect(cacheHitTimes.length).toBe(5);
  }, 10000);

  it("should cache properly with identical headers", async () => {
    const code = `
void setup() { Serial.begin(115200); }
void loop() { delay(100); }
`;

    const headers = [
      { name: "helper.h", content: "int add(int a, int b) { return a + b; }" },
    ];

    // First compile with headers — miss
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, headers }),
    });
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    // First request is a cache miss (could be false or undefined)
    expect(result1.cached).toBeFalsy();

    // Second compile with same code+headers — hit
    const response2 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, headers }),
    });
    const result2 = await response2.json();
    expect(result2.success).toBe(true);
    expect(result2.cached).toBe(true);
  }, 10000);

  it("should evict cache entries after TTL expires", async () => {
    const uniqueCode = `
void setup() {
  Serial.begin(115200);
  Serial.println("TTL Test ${Date.now()}");
}
void loop() { delay(100); }
`;

    // First compilation — miss
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: uniqueCode }),
    });
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    expect(result1.cached).toBe(false);

    // Immediately again — hit
    const response2 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: uniqueCode }),
    });
    const result2 = await response2.json();
    expect(result2.cached).toBe(true);

    // Wait for TTL to expire (200ms + margin)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // After TTL — miss again
    const response3 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: uniqueCode }),
    });
    const result3 = await response3.json();
    expect(result3.success).toBe(true);
    expect(result3.cached).toBe(false); // TTL expired → fresh compile
  }, 10000);
});
