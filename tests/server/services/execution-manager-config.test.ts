/**
 * Tests: SANDBOX_CONFIG reads environment variables
 * Phase 1.2 – configurable Docker resource limits
 */
import { describe, it, expect, afterEach, vi } from "vitest";

describe("SANDBOX_CONFIG – env-var resource limits", () => {
  afterEach(() => {
    delete process.env.SANDBOX_MEMORY_MB;
    delete process.env.SANDBOX_CPU_LIMIT;
    vi.resetModules();
  });

  it("uses SANDBOX_MEMORY_MB env var", async () => {
    process.env.SANDBOX_MEMORY_MB = "128";
    vi.resetModules();
    const { SANDBOX_CONFIG } = await import(
      "../../../server/services/sandbox/execution-manager"
    );
    expect(SANDBOX_CONFIG.maxMemoryMB).toBe(128);
  });

  it("uses SANDBOX_CPU_LIMIT env var", async () => {
    process.env.SANDBOX_CPU_LIMIT = "0.25";
    vi.resetModules();
    const { SANDBOX_CONFIG } = await import(
      "../../../server/services/sandbox/execution-manager"
    );
    expect(SANDBOX_CONFIG.cpuLimit).toBe("0.25");
  });

  it("falls back to default 64 MB when SANDBOX_MEMORY_MB not set", async () => {
    vi.resetModules();
    const { SANDBOX_CONFIG } = await import(
      "../../../server/services/sandbox/execution-manager"
    );
    expect(SANDBOX_CONFIG.maxMemoryMB).toBe(64);
  });

  it("falls back to default 0.25 CPU when SANDBOX_CPU_LIMIT not set", async () => {
    vi.resetModules();
    const { SANDBOX_CONFIG } = await import(
      "../../../server/services/sandbox/execution-manager"
    );
    expect(SANDBOX_CONFIG.cpuLimit).toBe("0.25");
  });
});
