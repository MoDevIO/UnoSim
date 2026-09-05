// prepare-phase.test.ts
// Unit tests for the extracted prepare-phase module

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performCompilation, type PrepareContext } from "../../../../../server/services/sandbox/execution-phases/prepare-phase";
import type { ExecutionState } from "../../../../../server/services/sandbox/execution-manager";
import type { RunSketchOptions } from "../../../../../server/services/sandbox/run-sketch-types";
import type { LocalCompiler } from "../../../../../server/services/sandbox/local-compiler";
import { Logger } from "@shared/logger";
import { SimulationState } from "../../../../../server/services/sandbox/execution-manager";

describe("prepare-phase", () => {
  let mockLocalCompiler: LocalCompiler;
  let mockLogger: Logger;
  let mockTransitionTo: ReturnType<PrepareContext["transitionTo"]>;
  let mockState: ExecutionState;
  let mockOpts: RunSketchOptions;

  beforeEach(() => {
    // Mock LocalCompiler
    mockLocalCompiler = {
      compile: vi.fn().mockResolvedValue(undefined),
      makeExecutable: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalCompiler;

    // Mock Logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    // Mock transitionTo
    mockTransitionTo = vi.fn().mockReturnValue(true);

    // Mock ExecutionState
    mockState = {
      processController: {} as any,
      state: SimulationState.STARTING,
    } as ExecutionState;

    // Mock RunSketchOptions
    mockOpts = {
      code: "void setup() {}",
      onOutput: vi.fn(),
      onError: vi.fn(),
      onExit: vi.fn(),
      onCompileError: vi.fn(),
      onCompileSuccess: vi.fn(),
      onCompileQueued: vi.fn(),
    } as RunSketchOptions;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should call localCompiler.compile and makeExecutable on successful compilation", async () => {
    const context: PrepareContext = {
      localCompiler: mockLocalCompiler,
      logger: mockLogger,
      transitionTo: mockTransitionTo,
    };

    await performCompilation("/tmp/sketch.cpp", "/tmp/sketch.exe", mockOpts, mockState, context);

    expect(mockLocalCompiler.compile).toHaveBeenCalledWith("/tmp/sketch.cpp", "/tmp/sketch.exe");
    expect(mockLocalCompiler.makeExecutable).toHaveBeenCalledWith("/tmp/sketch.exe");
    expect(mockOpts.onCompileSuccess).toHaveBeenCalled();
  });

  it("should call onCompileSuccess callback after successful compilation", async () => {
    const context: PrepareContext = {
      localCompiler: mockLocalCompiler,
      logger: mockLogger,
      transitionTo: mockTransitionTo,
    };

    await performCompilation("/tmp/sketch.cpp", "/tmp/sketch.exe", mockOpts, mockState, context);

    expect(mockOpts.onCompileSuccess).toHaveBeenCalledTimes(1);
  });

  it("should handle compilation errors gracefully", async () => {
    const context: PrepareContext = {
      localCompiler: mockLocalCompiler,
      logger: mockLogger,
      transitionTo: mockTransitionTo,
    };

    // Simulate a compilation error
    mockLocalCompiler.compile = vi.fn().mockRejectedValue(new Error("Compilation failed"));

    await expect(
      performCompilation("/tmp/sketch.cpp", "/tmp/sketch.exe", mockOpts, mockState, context)
    ).rejects.toThrow("Compilation failed");
  });

  it("should handle missing processController gracefully", async () => {
    const stateWithoutController = {
      ...mockState,
      processController: null,
    } as ExecutionState;

    const context: PrepareContext = {
      localCompiler: mockLocalCompiler,
      logger: mockLogger,
      transitionTo: mockTransitionTo,
    };

    // Should not throw when processController is null
    await performCompilation("/tmp/sketch.cpp", "/tmp/sketch.exe", mockOpts, stateWithoutController, context);

    // Compiler should not be called without processController
    expect(mockLocalCompiler.compile).not.toHaveBeenCalled();
  });

  it("should handle missing localCompiler gracefully", async () => {
    const contextWithoutCompiler: PrepareContext = {
      localCompiler: null as any,
      logger: mockLogger,
      transitionTo: mockTransitionTo,
    };

    // Should not throw when localCompiler is null
    await performCompilation("/tmp/sketch.cpp", "/tmp/sketch.exe", mockOpts, mockState, contextWithoutCompiler);

    expect(mockLocalCompiler.compile).not.toHaveBeenCalled();
  });
});
