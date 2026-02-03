// system-stress.test.ts
// Full-system stress test: Serial + Registry throttling

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { performance } from "perf_hooks";
import { ArduinoOutputParser } from "../../../src/utils/arduino-output-parser";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

describe("System stress (Serial + Registry)", () => {
  let parser: ArduinoOutputParser;
  let manager: RegistryManager;
  let updateCallback: ReturnType<typeof vi.fn>;
  const serialChunks: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    parser = new ArduinoOutputParser();
    serialChunks.length = 0;
    parser.on("data", (chunk: string) => {
      serialChunks.push(chunk);
    });

    updateCallback = vi.fn();
    manager = new RegistryManager({
      debounceMs: 20,
      onUpdate: updateCallback,
    });

    manager.startCollection();
    manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
    manager.finishCollection();

    // First registry send is immediate; exclude from throttling counts
    updateCallback.mockClear();
  });

  afterEach(() => {
    parser.reset();
    parser.removeAllListeners();
    vi.useRealTimers();
  });

  it("should preserve serial order and throttle registry updates under combined load", () => {
    const totalMs = 500;
    const serialPerMs = 10; // 5000 total
    const pinUpdatesPerMs = 20; // 10000 total

    let maxSliceMs = 0;

    for (let ms = 0; ms < totalMs; ms += 1) {
      const sliceStart = performance.now();

      for (let i = 0; i < serialPerMs; i += 1) {
        const index = ms * serialPerMs + i;
        parser.print(`Data Chunk ${index}\n`);
      }

      for (let i = 0; i < pinUpdatesPerMs; i += 1) {
        manager.updatePinValue(13, (ms * pinUpdatesPerMs + i) % 2);
      }

      const sliceDuration = performance.now() - sliceStart;
      if (sliceDuration > maxSliceMs) {
        maxSliceMs = sliceDuration;
      }

      vi.advanceTimersByTime(1);
    }

    // Validate serial chronology and completeness
    expect(serialChunks).toHaveLength(5000);
    for (let i = 0; i < 5000; i += 1) {
      expect(serialChunks[i]).toBe(`Data Chunk ${i}\n`);
    }

    // Validate throttling: with 20ms throttle over 500ms, max ~25 updates
    const registryUpdates = updateCallback.mock.calls.length;
    expect(registryUpdates).toBeGreaterThan(0);
    expect(registryUpdates).toBeLessThanOrEqual(25);

    // Performance: no single synchronous slice should block > 50ms
    expect(maxSliceMs).toBeLessThan(50);
  });
});
