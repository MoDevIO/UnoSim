import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilesystemHelper } from "../../../../server/services/sandbox/filesystem-helper";

// Use vi.hoisted so mock references are accessible before hoisted vi.mock runs
const { existsSyncMock, renameSyncMock, rmSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  renameSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  renameSync: renameSyncMock,
  rmSync: rmSyncMock,
  default: {
    existsSync: existsSyncMock,
    renameSync: renameSyncMock,
    rmSync: rmSyncMock,
  },
}));

import { existsSync, renameSync, rmSync } from "node:fs";

const mockExistsSync = vi.mocked(existsSync);
const mockRenameSync = vi.mocked(renameSync);
const mockRmSync = vi.mocked(rmSync);

function makeState(overrides: Partial<Parameters<FilesystemHelper["markTempDirForCleanup"]>[0]> = {}) {
  return {
    currentSketchDir: "/tmp/sketch",
    isCompiling: false,
    pendingCleanup: false,
    cleanupRetries: new Map<string, number>(),
    currentRegistryFile: null,
    ...overrides,
  };
}

function makeHelper() {
  const fileBuilder = {
    clearCreatedSketchDir: vi.fn(),
  } as any;
  const localCompiler = {
    isBusy: false,
  } as any;
  return new FilesystemHelper(fileBuilder, localCompiler);
}

describe("FilesystemHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("markRegistryForCleanup", () => {
    it("renames registry file from .pending.json to .cleanup.json", () => {
      const helper = makeHelper();
      const state = makeState({ currentRegistryFile: "/tmp/registry.pending.json" });
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementation(() => undefined);

      helper.markRegistryForCleanup(state);

      expect(mockRenameSync).toHaveBeenCalledWith(
        "/tmp/registry.pending.json",
        "/tmp/registry.cleanup.json",
      );
      expect(state.currentRegistryFile).toBeNull();
    });

    it("logs warning when renameSync fails (covers catch block lines 55-62)", () => {
      const helper = makeHelper();
      const state = makeState({ currentRegistryFile: "/tmp/registry.pending.json" });
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementation(() => {
        throw new Error("rename failed");
      });

      // Should not throw
      expect(() => helper.markRegistryForCleanup(state)).not.toThrow();
    });

    it("does nothing when currentRegistryFile is null", () => {
      const helper = makeHelper();
      const state = makeState({ currentRegistryFile: null });

      helper.markRegistryForCleanup(state);

      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it("does nothing when registry file does not exist", () => {
      const helper = makeHelper();
      const state = makeState({ currentRegistryFile: "/tmp/missing.pending.json" });
      mockExistsSync.mockReturnValue(false);

      helper.markRegistryForCleanup(state);

      expect(mockRenameSync).not.toHaveBeenCalled();
    });
  });

  describe("attemptCleanupDir (lines 80-102)", () => {
    it("returns true when rename succeeds", () => {
      const helper = makeHelper();
      mockRenameSync.mockImplementation(() => undefined);

      const result = helper.attemptCleanupDir("/tmp/sketch");

      expect(result).toBe(true);
      expect(mockRenameSync).toHaveBeenCalledWith("/tmp/sketch", "/tmp/sketch.cleanup");
    });

    it("falls back to rmSync when rename fails and returns true", () => {
      const helper = makeHelper();
      mockRenameSync.mockImplementation(() => {
        throw new Error("rename failed");
      });
      mockRmSync.mockImplementation(() => undefined);

      const result = helper.attemptCleanupDir("/tmp/sketch");

      expect(result).toBe(true);
      expect(mockRmSync).toHaveBeenCalledWith(
        "/tmp/sketch",
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it("returns false when both rename and rmSync fail (lines 95-100)", () => {
      const helper = makeHelper();
      mockRenameSync.mockImplementation(() => {
        throw new Error("rename failed");
      });
      mockRmSync.mockImplementation(() => {
        throw new Error("rm failed");
      });

      const result = helper.attemptCleanupDir("/tmp/sketch");

      expect(result).toBe(false);
    });
  });

  describe("scheduleCleanupRetry (lines 104-123)", () => {
    it("schedules a retry with setTimeout and calls unref", () => {
      vi.useFakeTimers();
      const helper = makeHelper();
      const state = makeState();
      mockExistsSync.mockReturnValue(false);

      helper.scheduleCleanupRetry(state, "/tmp/sketch");

      // Timer should be scheduled
      vi.runAllTimers();

      // After timer fires and dir no longer exists, cleanupRetries should be cleared
      expect(state.cleanupRetries.has("/tmp/sketch")).toBe(false);
      vi.useRealTimers();
    });

    it("stops after 8 attempts to prevent infinite retries", () => {
      const helper = makeHelper();
      const state = makeState();
      state.cleanupRetries.set("/tmp/sketch", 8);

      // Should not schedule another timer
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      helper.scheduleCleanupRetry(state, "/tmp/sketch");

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it("retries cleanup in setTimeout callback when dir still exists but cleanup succeeds", () => {
      vi.useFakeTimers();
      const helper = makeHelper();
      const state = makeState();
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementation(() => undefined);

      helper.scheduleCleanupRetry(state, "/tmp/sketch");
      vi.runAllTimers();

      expect(state.cleanupRetries.has("/tmp/sketch")).toBe(false);
      vi.useRealTimers();
    });

    it("recurses when cleanup fails in retry callback", () => {
      vi.useFakeTimers();
      const helper = makeHelper();
      const state = makeState();
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementation(() => {
        throw new Error("fail");
      });
      mockRmSync.mockImplementation(() => {
        throw new Error("fail");
      });

      helper.scheduleCleanupRetry(state, "/tmp/sketch");
      vi.runAllTimers(); // retry nr 1, attempts becomes 2
      // ensure it registered attempt without infinite loop
      expect(state.cleanupRetries.get("/tmp/sketch")).toBeGreaterThan(0);
      vi.useRealTimers();
    });
  });

  describe("markTempDirForCleanup", () => {
    it("does nothing when currentSketchDir is null", () => {
      const helper = makeHelper();
      const state = makeState({ currentSketchDir: null });

      helper.markTempDirForCleanup(state);

      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it("defers cleanup when compilation is in progress", () => {
      const helper = makeHelper();
      const state = makeState({ isCompiling: true });

      helper.markTempDirForCleanup(state);

      expect(state.pendingCleanup).toBe(true);
      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it("clears tracking when dir does not exist", () => {
      const helper = makeHelper();
      const state = makeState();
      mockExistsSync.mockReturnValue(false);

      helper.markTempDirForCleanup(state);

      expect(state.currentSketchDir).toBeNull();
    });

    it("calls scheduleCleanupRetry when attemptCleanupDir fails (line 154)", () => {
      const helper = makeHelper();
      const state = makeState();
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementation(() => {
        throw new Error("fail");
      });
      mockRmSync.mockImplementation(() => {
        throw new Error("fail");
      });
      const retrySpy = vi.spyOn(helper, "scheduleCleanupRetry");

      helper.markTempDirForCleanup(state);

      expect(retrySpy).toHaveBeenCalledWith(state, "/tmp/sketch");
    });
  });
});
