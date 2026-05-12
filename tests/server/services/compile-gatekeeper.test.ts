import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the unified gatekeeper dependency
const mockUnified = {
  acquireCompileSlotHighPriority: vi.fn().mockResolvedValue(vi.fn()),
  acquireCompileSlot: vi.fn().mockResolvedValue(vi.fn()),
  getStats: vi.fn().mockReturnValue({
    maxConcurrentCompiles: 4,
    availableSlots: 3,
    activeCompiles: 1,
    queuedCompiles: 0,
  }),
  drain: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../server/services/unified-gatekeeper", () => ({
  getUnifiedGatekeeper: () => mockUnified,
  TaskPriority: { NORMAL: 1, HIGH: 2 },
}));

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

describe("CompileGatekeeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("acquire delegates to unified gatekeeper", async () => {
    const releaseFn = vi.fn();
    mockUnified.acquireCompileSlot.mockResolvedValueOnce(releaseFn);

    const { getCompileGatekeeper } = await import("../../../server/services/compile-gatekeeper");
    const gk = getCompileGatekeeper(4);
    const release = await gk.acquire();

    expect(mockUnified.acquireCompileSlot).toHaveBeenCalled();
    expect(release).toBe(releaseFn);
  });

  it("acquireHighPriority delegates to unified gatekeeper", async () => {
    const releaseFn = vi.fn();
    mockUnified.acquireCompileSlotHighPriority.mockResolvedValueOnce(releaseFn);

    const { getCompileGatekeeper } = await import("../../../server/services/compile-gatekeeper");
    const gk = getCompileGatekeeper(4);
    const release = await gk.acquireHighPriority();

    expect(mockUnified.acquireCompileSlotHighPriority).toHaveBeenCalledWith("simulation-start", undefined);
    expect(release).toBe(releaseFn);
  });

  it("getStats returns mapped stats", async () => {
    const { getCompileGatekeeper } = await import("../../../server/services/compile-gatekeeper");
    const gk = getCompileGatekeeper(4);
    const stats = gk.getStats();

    expect(stats).toEqual({
      maxConcurrent: 4,
      available: 3,
      active: 1,
      queued: 0,
    });
  });

  it("drain delegates to unified gatekeeper", async () => {
    const { getCompileGatekeeper } = await import("../../../server/services/compile-gatekeeper");
    const gk = getCompileGatekeeper(4);
    await gk.drain();

    expect(mockUnified.drain).toHaveBeenCalled();
  });
});
