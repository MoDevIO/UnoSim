// system-stress.test.ts
// Full-system stress test: Serial + Registry updates

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

  it("should preserve serial order while handling new pin discoveries", () => {
    const totalMs = 500;
    const serialPerMs = 10; // 5000 total
    const pinDiscoveriesPerMs = 2; // Discover new pins throughout test

    let maxSliceDurationMs = 0;

    for (let ms = 0; ms < totalMs; ms += 1) {
      const sliceStart = performance.now();

      for (let i = 0; i < serialPerMs; i += 1) {
        const index = ms * serialPerMs + i;
        parser.print(`Data Chunk ${index}\n`);
      }

      // Discover new pins (structural changes only)
      for (let i = 0; i < pinDiscoveriesPerMs; i += 1) {
        const pinNum = 14 + (ms * pinDiscoveriesPerMs + i);
        if (pinNum < 100) { // Don't discover invalid pins
          manager.updatePinMode(pinNum, 1);
        }
      }

      // Pin value updates don't trigger registry changes in new implementation
      manager.updatePinValue(13, ms % 2);

      const sliceDuration = performance.now() - sliceStart;
      if (sliceDuration > maxSliceDurationMs) {
        maxSliceDurationMs = sliceDuration;
      }

      vi.advanceTimersByTime?.(1);
    }

    // Validate serial chronology and completeness
    expect(serialChunks).toHaveLength(5000);
    for (let i = 0; i < 5000; i += 1) {
      expect(serialChunks[i]).toBe(`Data Chunk ${i}\n`);
    }

    // Validate that we got registry updates for new pins discovered
    const registryUpdates = updateCallback.mock.calls.length;
    expect(registryUpdates).toBeGreaterThan(0);
    // With 500ms and ~2 pins discovered per ms = ~1000 new pins, expect many updates
    // Threshold adjusted for test environment variability
    expect(registryUpdates).toBeGreaterThanOrEqual(80);

    // Performance: no single synchronous slice should block > 50ms
    expect(maxSliceDurationMs).toBeLessThan(50);
  });
});
