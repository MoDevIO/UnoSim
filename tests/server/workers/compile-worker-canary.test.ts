import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Canary tests to ensure critical worker thread files exist.
 *
 * These tests guard against accidental deletion of worker files
 * which would cause the compilation pipeline to crash at runtime.
 * If any of these tests fail, the worker pool will not function.
 */
describe("compile-worker file canary", () => {
  const root = process.cwd();

  it("compile-worker.ts source file exists", () => {
    expect(existsSync(join(root, "server/services/workers/compile-worker.ts"))).toBe(true);
  });

  it("compile-worker-utils.ts source file exists", () => {
    expect(existsSync(join(root, "server/services/workers/compile-worker-utils.ts"))).toBe(true);
  });

  it("worker-protocol.ts shared module exists", () => {
    expect(existsSync(join(root, "shared/worker-protocol.ts"))).toBe(true);
  });

  it("compilation-worker-pool.ts pool manager exists", () => {
    expect(existsSync(join(root, "server/services/compilation-worker-pool.ts"))).toBe(true);
  });

  it("compile-worker-utils exports expected functions", async () => {
    const utils = await import("../../../server/services/workers/compile-worker-utils");
    expect(typeof utils.normalizeLibraries).toBe("function");
    expect(typeof utils.buildSketchHash).toBe("function");
    expect(typeof utils.checkFileExists).toBe("function");
    expect(typeof utils.checkBinaryExists).toBe("function");
    expect(typeof utils.acquireCoreCacheLock).toBe("function");
    expect(typeof utils.collectDirectoryRecords).toBe("function");
    expect(typeof utils.evictLruEntries).toBe("function");
    expect(typeof utils.cleanupCacheLru).toBe("function");
    expect(typeof utils.ensureDirectories).toBe("function");
    expect(typeof utils.execArduinoCliJson).toBe("function");
  });

  it("worker-protocol exports type guards and factories", async () => {
    const protocol = await import("../../../shared/worker-protocol");
    expect(typeof protocol.isCompileRequest).toBe("function");
    expect(typeof protocol.isCompileResponse).toBe("function");
    expect(typeof protocol.isReadyMessage).toBe("function");
    expect(typeof protocol.isShutdownMessage).toBe("function");
    expect(typeof protocol.createCompileRequest).toBe("function");
    expect(typeof protocol.createCompileResponse).toBe("function");
    expect(typeof protocol.createReadyMessage).toBe("function");
    expect(typeof protocol.createWorkerError).toBe("function");
  });
});
