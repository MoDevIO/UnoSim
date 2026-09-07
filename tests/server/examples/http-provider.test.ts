import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../../server/config", () => ({
  config: {
    nodeEnv: "test",
    examples: {
      source: "https://examples.test/unosim",
      ref: "2026-SS",
      refreshMs: 60_000,
      timeoutMs: 1_000,
      maxManifestBytes: 64 * 1024,
      maxFileBytes: 64 * 1024,
      maxTotalBytes: 128 * 1024,
      maxFiles: 10,
      allowedHosts: ["examples.test"],
      allowHttp: false,
    },
  },
}));

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]) },
}));

describe("HttpProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("loads and caches a validated multi-file example", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 1,
        examples: [{
          id: "motor-control",
          title: "Motor Control",
          category: "Motors",
          files: [
            { name: "motor-control.ino", path: "motors/motor-control/motor-control.ino" },
            { name: "motor.h", path: "motors/motor-control/motor.h" },
          ],
          main: "motor-control.ino",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("void setup(){}", { status: 200 }))
      .mockResolvedValueOnce(new Response("#pragma once", { status: 200 }));

    const { HttpProvider } = await import("../../../server/services/examples/http-provider");
    const provider = new HttpProvider();
    const first = await provider.getExamples();
    const second = await provider.getExamples();

    expect(first?.examples[0].files).toHaveLength(2);
    expect(first?.examples[0].files[1].content).toBe("#pragma once");
    expect(second?.status).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects redirects and leaves no remote snapshot", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://attacker.test/manifest.json" } }));

    const { HttpProvider } = await import("../../../server/services/examples/http-provider");
    const provider = new HttpProvider();

    await expect(provider.getExamples()).resolves.toBeNull();
  });
});
