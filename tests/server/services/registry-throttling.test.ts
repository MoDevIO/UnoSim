// registry-throttling.test.ts
// Performance-style test for RegistryManager debounce starvation

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

describe("RegistryManager throttling", () => {
  let manager: RegistryManager;
  let updateCallback: jest.Mock<(registry: IOPinRecord[], baudrate: number) => void>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));

    updateCallback = jest.fn();
    manager = new RegistryManager({
      debounceMs: 50,
      onUpdate: updateCallback,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow throttled callbacks when pin value updates flood within 100ms", () => {
    manager.startCollection();
    manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
    manager.finishCollection();

    // First send happens immediately
    expect(updateCallback).toHaveBeenCalledTimes(1);
    updateCallback.mockClear();

    const totalUpdates = 1000;

    for (let i = 0; i < totalUpdates; i += 1) {
      // Spread 1000 updates across 100ms (10 updates per ms)
      if (i % 10 === 0 && i !== 0) {
        jest.advanceTimersByTime(1);
      }

      manager.updatePinValue(13, i % 2);
    }

    // Allow any pending throttle timer to fire (up to the 100ms boundary)
    jest.advanceTimersByTime(100);

    // Expect 1-2 updates during the 100ms load with 50ms throttling
    expect(updateCallback.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(updateCallback.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
