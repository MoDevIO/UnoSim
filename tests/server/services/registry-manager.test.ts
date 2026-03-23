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

      const _firstRegistry = manager.getRegistry();
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

  // ──────────────────────────────────────────────────────────────────────────
  // Runtime conflict detection
  //
  // Simulates what happens when a sketch runs:
  //   for (int i = 1; i <= 6; i++) pinMode(i, INPUT);   // Loop 1
  //   for (int i = 6; i <= 10; i++) pinMode(i, OUTPUT); // Loop 2
  //
  // Pin 6 gets two updatePinMode() calls: first INPUT (0), then OUTPUT (1).
  // The sent IOPinRecord for pin 6 must reflect BOTH modes so that the client
  // can flag the conflict.  This requires that runtime usedAt entries (which
  // always have line=0) survive the cleanupPinRecord() call inside sendNow().
  // ──────────────────────────────────────────────────────────────────────────
  describe("runtime conflict detection (braceless for-loop scenario)", () => {
    it("runtime usedAt entries (line=0) must survive sendNow cleanup", () => {
      // Simulate the IO_REGISTRY_START…END burst first (pre-populates 20 pins)
      manager.startCollection();
      for (let i = 0; i <= 13; i++) {
        manager.addPin({ pin: String(i), defined: false, pinMode: 0, usedAt: [] });
      }
      for (let i = 0; i <= 5; i++) {
        manager.addPin({ pin: `A${i}`, defined: false, pinMode: 0, usedAt: [] });
      }
      manager.finishCollection();
      updateCallback.mockClear();

      // Loop 1: pins 1..6 as INPUT – simulated via [[PIN_MODE:X:0]] messages
      for (let pin = 1; pin <= 6; pin++) {
        manager.updatePinMode(pin, 0); // INPUT
      }
      // Loop 2: pins 6..10 as OUTPUT
      for (let pin = 6; pin <= 10; pin++) {
        manager.updatePinMode(pin, 1); // OUTPUT
      }

      // Get the last registry that was sent to the client
      const lastCall = updateCallback.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      const sentRegistry: IOPinRecord[] = lastCall[0];

      const pin6 = sentRegistry.find((r) => r.pin === "6");
      expect(pin6).toBeDefined();

      // usedAt must contain BOTH "pinMode:0" (INPUT) and "pinMode:1" (OUTPUT)
      expect(pin6!.usedAt).toContainEqual(
        expect.objectContaining({ operation: "pinMode:0" }),
      );
      expect(pin6!.usedAt).toContainEqual(
        expect.objectContaining({ operation: "pinMode:1" }),
      );
    });

    it("pin 6 must be flagged as conflict=true when it receives both INPUT and OUTPUT", () => {
      manager.startCollection();
      for (let i = 0; i <= 13; i++) {
        manager.addPin({ pin: String(i), defined: false, pinMode: 0, usedAt: [] });
      }
      manager.finishCollection();
      updateCallback.mockClear();

      manager.updatePinMode(6, 0); // INPUT (from loop 1)
      manager.updatePinMode(6, 1); // OUTPUT (from loop 2) → conflict!

      const sentRegistry: IOPinRecord[] =
        updateCallback.mock.calls.at(-1)[0];
      const pin6 = sentRegistry.find((r) => r.pin === "6");

      expect(pin6).toBeDefined();
      expect(pin6!.conflict).toBe(true);
    });

    it("no conflict flag for pin that has only one mode", () => {
      manager.startCollection();
      manager.addPin({ pin: "7", defined: false, pinMode: 0, usedAt: [] });
      manager.finishCollection();
      updateCallback.mockClear();

      manager.updatePinMode(7, 1); // single OUTPUT call

      const sentRegistry: IOPinRecord[] =
        updateCallback.mock.calls.at(-1)[0];
      const pin7 = sentRegistry.find((r) => r.pin === "7");

      expect(pin7).toBeDefined();
      expect(pin7!.conflict).toBeFalsy();
    });
  });
});
