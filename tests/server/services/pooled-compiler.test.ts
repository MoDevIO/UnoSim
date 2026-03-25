import { describe, it, expect, vi, afterEach } from "vitest";
import { PooledCompiler, getPooledCompiler } from "../../../server/services/pooled-compiler";
import type { CompilationResult } from "../../../server/services/arduino-compiler";

// Mock the compilation pool
vi.mock("../../../server/services/compilation-worker-pool", () => ({
  getCompilationPool: vi.fn(() => ({
    compile: vi.fn(async () => ({ success: true, binary: "mock-binary" })),
    getStats: vi.fn(() => ({
      activeWorkers: 2,
      totalTasks: 10,
      completedTasks: 8,
      failedTasks: 1,
      avgCompileTimeMs: 500,
      queuedTasks: 1,
    })),
    shutdown: vi.fn(async () => {}),
  })),
  CompilationWorkerPool: vi.fn(),
}));

// Mock ArduinoCompiler to avoid actual compilation
vi.mock("../../../server/services/arduino-compiler", () => ({
  ArduinoCompiler: vi.fn().mockImplementation(function () {
    this.compile = vi.fn(async () => ({
      success: true,
      binary: "direct-mock-binary",
    } as CompilationResult));
  }),
}));

describe("PooledCompiler", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  describe("Development mode (NODE_ENV != production)", () => {
    it("uses direct compiler in development mode", async () => {
      process.env.NODE_ENV = "test";
      const compiler = new PooledCompiler();

      const result = await compiler.compile("void setup() {} void loop() {}");

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("getStats returns zero stats without pool in development", () => {
      process.env.NODE_ENV = "test";
      const compiler = new PooledCompiler();

      const stats = compiler.getStats();

      expect(stats).toEqual({
        activeWorkers: 0,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        avgCompileTimeMs: 0,
        queuedTasks: 0,
      });
    });

    it("shutdown is a no-op without pool in development", async () => {
      process.env.NODE_ENV = "test";
      const compiler = new PooledCompiler();

      await expect(compiler.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("Production mode (NODE_ENV = production)", () => {
    it("uses pool in production mode", async () => {
      process.env.NODE_ENV = "production";
      const mockPool = {
        compile: vi.fn(async () => ({ success: true, binary: "pool-binary" } as CompilationResult)),
        getStats: vi.fn(() => ({ activeWorkers: 1, totalTasks: 5, completedTasks: 4, failedTasks: 0, avgCompileTimeMs: 300, queuedTasks: 1 })),
        shutdown: vi.fn(async () => {}),
      };

      const compiler = new PooledCompiler(mockPool as any);
      const result = await compiler.compile("void setup() {}");

      expect(mockPool.compile).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("getStats returns pool stats in production", () => {
      process.env.NODE_ENV = "production";
      const mockPool = {
        compile: vi.fn(),
        getStats: vi.fn(() => ({
          activeWorkers: 2,
          totalTasks: 10,
          completedTasks: 8,
          failedTasks: 1,
          avgCompileTimeMs: 500,
          queuedTasks: 1,
        })),
        shutdown: vi.fn(),
      };

      const compiler = new PooledCompiler(mockPool as any);
      const stats = compiler.getStats();

      expect(mockPool.getStats).toHaveBeenCalled();
      expect(stats.activeWorkers).toBe(2);
      expect(stats.totalTasks).toBe(10);
    });

    it("shutdown calls pool.shutdown in production", async () => {
      process.env.NODE_ENV = "production";
      const mockPool = {
        compile: vi.fn(),
        getStats: vi.fn(),
        shutdown: vi.fn(async () => {}),
      };

      const compiler = new PooledCompiler(mockPool as any);
      await compiler.shutdown();

      expect(mockPool.shutdown).toHaveBeenCalled();
    });

    it("compile throws when neither pool nor direct compiler is available", async () => {
      // This case shouldn't happen normally but tests the error path
      process.env.NODE_ENV = "test";
      const compiler = new PooledCompiler();

      // Forcibly remove both by hacking internal state
      (compiler as any).pool = null;
      (compiler as any).directCompiler = null;
      (compiler as any).usePool = false;

      await expect(compiler.compile("void setup() {}")).rejects.toThrow(
        "Neither pool nor direct compiler available",
      );
    });
  });

  describe("getPooledCompiler singleton", () => {
    it("returns a PooledCompiler instance", () => {
      const compiler = getPooledCompiler();
      expect(compiler).toBeInstanceOf(PooledCompiler);
    });
  });
});
