// registry-throttling.test.ts
// Test for RegistryManager behavior with pin value updates
// Note: Pin value updates don't trigger registry sends in the new implementation
// Only structural changes (new pins) trigger sends

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

describe("RegistryManager throttling", () => {
  let manager: RegistryManager;
  let updateCallback: jest.Mock<(registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void>;

  beforeEach(() => {
    updateCallback = vi.fn();
    manager = new RegistryManager({
      onUpdate: updateCallback,
    });
  });

  it("should send immediately when discovering new pins (structural changes)", () => {
    manager.startCollection();
    manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
    manager.finishCollection();

    // First send happens during finishCollection
    expect(updateCallback).toHaveBeenCalledTimes(1);
    updateCallback.mockClear();

    // Discover 5 new pins via updatePinMode
    for (let i = 12; i >= 8; i--) {
      manager.updatePinMode(i, 1);
      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("pin-new-record");
      updateCallback.mockClear();
    }

    // Verify 5 new pins were discovered
    expect(manager.getRegistry()).toHaveLength(6); // Original + 5 new
  });

  it("should not trigger callbacks on pin value updates (performance optimization)", () => {
    manager.startCollection();
    manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
    manager.finishCollection();

    // First send happens during finishCollection
    expect(updateCallback).toHaveBeenCalledTimes(1);
    updateCallback.mockClear();

    // Rapid pin value updates should NOT trigger callbacks
    for (let i = 0; i < 1000; i++) {
      manager.updatePinValue(13, i % 2);
    }

    // No additional callbacks - only telemetry is tracked
    expect(updateCallback).not.toHaveBeenCalled();
  });
});
