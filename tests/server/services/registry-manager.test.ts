// registry-manager.test.ts
// Unit tests for RegistryManager

import { describe, it, expect, beforeEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

describe("RegistryManager", () => {
  let manager: RegistryManager;
  let updateCallback: jest.Mock<(registry: IOPinRecord[], baudrate: number) => void>;

  beforeEach(() => {
    updateCallback = vi.fn();
    manager = new RegistryManager({
      debounceMs: 100,
      onUpdate: updateCallback,
    });
  });

  describe("startCollection and finishCollection", () => {
    it("should collect pins between start and end markers", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.addPin({ pin: "12", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      expect(manager.getRegistry()).toHaveLength(2);
      expect(manager.getRegistry()[0].pin).toBe("13");
      expect(manager.getRegistry()[1].pin).toBe("12");
    });

    it("should ignore pins added before startCollection", () => {
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      expect(manager.getRegistry()).toHaveLength(0);
    });

    it("should reset registry on new collection", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      manager.startCollection();
      manager.addPin({ pin: "12", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      expect(manager.getRegistry()).toHaveLength(1);
      expect(manager.getRegistry()[0].pin).toBe("12");
    });

    it("should deduplicate repeated IO_PIN records by pin", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.addPin({ pin: "A0", defined: true, pinMode: 0, usedAt: [] });
      manager.addPin({ pin: "A0", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      const registry = manager.getRegistry();
      expect(registry).toHaveLength(2);
      expect(registry.find((p) => p.pin === "13")).toBeDefined();
      expect(registry.find((p) => p.pin === "A0")).toBeDefined();
    });
  });

  describe("updatePinMode", () => {
    it("should update existing pin mode", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      manager.updatePinMode(13, 1);

      const registry = manager.getRegistry();
      expect(registry[0].pinMode).toBe(1);
      expect(registry[0].usedAt).toContainEqual({
        line: 0,
        operation: "pinMode:1",
      });
    });

    it("should create new pin if not in registry", () => {
      manager.startCollection();
      manager.finishCollection();

      manager.updatePinMode(13, 1);

      const registry = manager.getRegistry();
      expect(registry).toHaveLength(1);
      expect(registry[0].pin).toBe("13");
      expect(registry[0].pinMode).toBe(1);
    });

    it("should handle analog pin notation", () => {
      manager.startCollection();
      manager.finishCollection();

      manager.updatePinMode(14, 0); // A0

      const registry = manager.getRegistry();
      expect(registry[0].pin).toBe("A0");
    });
  });

  describe("baudrate management", () => {
    it("should update baudrate when changed", () => {
      manager.setBaudrate(115200);

      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledWith(
        expect.any(Array),
        115200,
        "collection-complete",
      );
    });

    it("should ignore invalid baudrate and skip default 9600", () => {
      manager.setBaudrate(9600); // Default - should be skipped
      manager.setBaudrate(0);
      manager.setBaudrate(-100);

      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      // Baudrate should be undefined because 9600 is default and is skipped
      expect(updateCallback).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        "collection-complete",
      );
    });
  });

  describe("debouncing behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should send first registry immediately without debounce", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
    });

    it("should send when discovering a new pin via updatePinMode", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      // Discover a new pin via updatePinMode - should trigger immediate send
      manager.updatePinMode(12, 0);

      // Should send immediately (structural change - new pin)
      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("pin-new-record");
    });

    it("should debounce rapid pin mode updates", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      updateCallback.mockClear();

      // Discover new pins rapidly - each should trigger immediate send
      manager.updatePinMode(12, 1);
      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();
      
      manager.updatePinMode(11, 0);
      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();
      
      manager.updatePinMode(10, 1);
      expect(updateCallback).toHaveBeenCalledTimes(1);
    });

    it("should defer pin-new-record sends while collection is active", () => {
      manager.startCollection();
      manager.updatePinMode(12, 1);
      manager.updatePinMode(11, 0);

      // No immediate sends during active collection
      expect(updateCallback).not.toHaveBeenCalled();

      manager.finishCollection();

      // Single batched send at end of collection
      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("collection-complete");
      expect(updateCallback.mock.calls[0][0]).toHaveLength(2);
    });

    it("should not send if registry hash unchanged", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      const firstRegistry = manager.getRegistry();
      updateCallback.mockClear();

      // Try to send same registry again
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).not.toHaveBeenCalled();
    });
  });

  describe("wait mode", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should enable wait mode with timeout", () => {
      manager.enableWaitMode(500);

      expect(manager.isWaiting()).toBe(true);

      vi.advanceTimersByTime(500);

      expect(manager.isWaiting()).toBe(false);
    });

    it("should release wait mode when first registry is sent", () => {
      manager.enableWaitMode(500);
      expect(manager.isWaiting()).toBe(true);

      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(manager.isWaiting()).toBe(false);
    });

    it("should suppress pin-new-record while waiting and send once on collection-complete", () => {
      manager.enableWaitMode(1000);

      manager.updatePinMode(14, 0); // A0 before IO_REGISTRY_START
      manager.updatePinMode(0, 0);
      manager.updatePinMode(1, 0);

      // No immediate spam while waiting for registry sync
      expect(updateCallback).not.toHaveBeenCalled();

      manager.startCollection();
      manager.addPin({ pin: "A0", defined: true, pinMode: 2, usedAt: [] });
      manager.addPin({ pin: "0", defined: true, pinMode: 0, usedAt: [] });
      manager.addPin({ pin: "1", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("collection-complete");
    });

    it("should flush dirty registry once when wait mode times out", () => {
      manager.enableWaitMode(500);
      manager.updatePinMode(13, 1);
      manager.updatePinMode(12, 0);

      expect(updateCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);

      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("wait-timeout-flush");
    });

    it("should suppress pins discovered during wait-mode even with long compilation delay", () => {
      // Scenario: enableWaitMode(5000) called, but compilation takes ~1s
      // PIN_MODE events may arrive before wait-timeout, then collection starts
      manager.enableWaitMode(5000);
      
      // Fast PIN_MODE events arrive (wait still active)
      manager.updatePinMode(14, 0); // A0
      manager.updatePinMode(0, 0);
      expect(updateCallback).not.toHaveBeenCalled();
      
      // Then collection starts
      manager.startCollection();
      manager.updatePinMode(1, 0);
      
      // Still nothing sent
      expect(updateCallback).not.toHaveBeenCalled();
      
      // Collection completes with batched pins
      manager.addPin({ pin: "A0", defined: true, pinMode: 0, usedAt: [] });
      manager.addPin({ pin: "0", defined: true, pinMode: 0, usedAt: [] });
      manager.addPin({ pin: "1", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();
      
      // Exactly one send
      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("collection-complete");
      expect(updateCallback.mock.calls[0][0]).toHaveLength(3);
    });
  });

  describe("reset", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should clear all state", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      manager.enableWaitMode(500);

      manager.reset();

      expect(manager.getRegistry()).toHaveLength(0);
      expect(manager.isWaiting()).toBe(false);
    });

    it("should clear all timers", () => {
      manager.enableWaitMode(500);
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      // Try to discover a new pin that would trigger a send
      updateCallback.mockClear();
      manager.updatePinMode(12, 0);
      
      // One call from discovering the new pin
      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      manager.reset();

      vi.advanceTimersByTime(1000);

      // No additional callbacks should fire after reset
      expect(updateCallback).not.toHaveBeenCalled();
    });

    it("should allow new collection after reset", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      manager.reset();
      updateCallback.mockClear();

      manager.startCollection();
      manager.addPin({ pin: "12", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(manager.getRegistry()).toHaveLength(1);
      expect(manager.getRegistry()[0].pin).toBe("12");
    });
  });

  describe("change detection", () => {
    it("should detect new pin discovery and send immediately", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      // Discover a new pin via updatePinMode
      manager.updatePinMode(12, 0);

      // Should send immediately (structural change)
      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(updateCallback.mock.calls[0][2]).toBe("pin-new-record");
    });

    it("should not send duplicate registry data", () => {
      const registry1: IOPinRecord[] = [
        { pin: "13", defined: true, pinMode: 1, usedAt: [] },
      ];

      manager.startCollection();
      manager.addPin(registry1[0]);
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      // Try to send identical registry
      manager.startCollection();
      manager.addPin(registry1[0]);
      manager.finishCollection();

      expect(updateCallback).not.toHaveBeenCalled();
    });
  });
});
