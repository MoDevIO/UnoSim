import { createRequire } from "node:module";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

/**
 * GHSA-27r3-jxmh-p828 (CVE-2026-111181): body-parser before 1.20.9 left the decompression stream of a
 * compressed request piped without an error listener, so trailing bytes after the compressed frame could
 * end the process with an uncaught exception. The patched version is what the lockfile must keep.
 */
// The body-parser express itself uses (hoisted or nested, whichever the install chose).
const fromExpress = createRequire(createRequire(import.meta.url).resolve("express"));
const [major = 0, minor = 0, patch = 0] = (fromExpress("body-parser/package.json") as { version: string }).version
  .split(".")
  .map(Number);

let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe("body-parser (request decompression)", () => {
  it("is the patched 1.20.9 or later", () => {
    expect(major).toBe(1);
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(20 * 1000 + 9);
  });

  it.each([
    ["gzip", gzipSync],
    ["deflate", deflateSync],
  ] as const)("answers a %s request with trailing bytes without an unhandled error", async (encoding, compress) => {
    const unhandled: Error[] = [];
    const onUncaught = (error: Error) => unhandled.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const app = express();
      app.use(express.json());
      app.post("/x", (_req, res) => res.json({ ok: true }));
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server?.once("listening", resolve));
      const frame = compress(JSON.stringify({ a: 1 }));

      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          { host: "127.0.0.1", port: (server?.address() as AddressInfo).port, path: "/x", method: "POST", headers: { "content-type": "application/json", "content-encoding": encoding, "content-length": frame.length + 2 } },
          (response) => { response.resume(); response.on("end", () => resolve(response.statusCode ?? 0)); },
        );
        request.on("error", reject);
        request.write(frame);
        setTimeout(() => request.end(Buffer.from([0xff, 0xff])), 50);
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect([200, 400]).toContain(status);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
