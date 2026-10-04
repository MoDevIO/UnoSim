import { describe, expect, it } from "vitest";
import { runRestCompileBatch } from "../../scripts/capacity-rest-compile";

describe("REST compile capacity workload", () => {
  it("bounds concurrency and records latency, failures, and HTTP 503 responses", async () => {
    let active = 0;
    let peakActive = 0;
    const sourceByRequest: string[] = [];
    const fetcher = async (_input: unknown, init?: RequestInit): Promise<Response> => {
      active++;
      peakActive = Math.max(peakActive, active);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-test-run-id")).toBe("capacity_test_123");
      const request = JSON.parse(String(init?.body)) as { code: string };
      const match = /REST_COMPILE_REQUEST_(\d+)/.exec(request.code);
      expect(match).not.toBeNull();
      const index = Number(match?.[1]);
      sourceByRequest[index] = request.code;
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;

      if (index === 1) return Response.json({ success: false }, { status: 503 });
      if (index === 3) return Response.json({ success: false }, { status: 500 });
      return Response.json({ success: true }, { status: 200 });
    };

    const result = await runRestCompileBatch({
      baseUrl: "http://127.0.0.1:3000",
      runId: "capacity_test_123",
      requestCount: 4,
      concurrency: 2,
    }, fetcher as typeof fetch);

    expect(peakActive).toBe(2);
    expect(result).toMatchObject({
      requested: 4,
      concurrency: 2,
      completed: 4,
      successful: 2,
      failed: 2,
      serviceUnavailable: 1,
    });
    expect(result.latencyMs).toHaveLength(4);
    expect(result.results.every((item) => item.completedAtMs >= item.startedAtMs
      && item.latencyMs === item.completedAtMs - item.startedAtMs)).toBe(true);
    expect(result.results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 200, 500, 503]);
    expect(new Set(sourceByRequest).size).toBe(4);
  });

  it("rejects unbounded batch sizes and invalid concurrency", async () => {
    const fetcher = async (): Promise<Response> => Response.json({ success: true });
    await expect(runRestCompileBatch({
      baseUrl: "http://127.0.0.1:3000",
      runId: "capacity_test_123",
      requestCount: 129,
      concurrency: 1,
    }, fetcher as typeof fetch)).rejects.toThrow(/1 and 128/);
    await expect(runRestCompileBatch({
      baseUrl: "http://127.0.0.1:3000",
      runId: "capacity_test_123",
      requestCount: 2,
      concurrency: 3,
    }, fetcher as typeof fetch)).rejects.toThrow(/concurrency/);
  });
});
