// registry-manager.test.ts
// Unit tests for RegistryManager

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

describe("RegistryManager", () => {
  let manager: RegistryManager;
  let updateCallback: jest.Mock<(registry: IOPinRecord[], baudrate: number) => void>;

  beforeEach(() => {
    updateCallback = jest.fn();
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
      );
    });

    it("should ignore invalid baudrate", () => {
      manager.setBaudrate(9600);
      manager.setBaudrate(0);
      manager.setBaudrate(-100);

      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledWith(
        expect.any(Array),
        9600,
      );
    });
  });

  describe("debouncing behavior", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should send first registry immediately without debounce", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
    });

    it("should allow subsequent sends with changed registry", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      // Update pin mode - registry content changes
      manager.updatePinMode(13, 0);

      // Should debounce but not send immediately
      expect(updateCallback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      // Should send after debounce
      expect(updateCallback).toHaveBeenCalledTimes(1);
    });

    it("should debounce rapid pin mode updates", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 0, usedAt: [] });
      manager.finishCollection();

      const firstCallTime = Date.now();
      updateCallback.mockClear();

      // Make rapid updates within short time window
      manager.updatePinMode(13, 1);
      
      jest.advanceTimersByTime(20);
      manager.updatePinMode(13, 0);
      
      jest.advanceTimersByTime(20);
      manager.updatePinMode(13, 1);
      
      // Should not have sent yet (still within debounce window)
      expect(updateCallback).not.toHaveBeenCalled();

      // After full debounce period from last update
      jest.advanceTimersByTime(100);
      
      // Should send exactly once with final state
      expect(updateCallback).toHaveBeenCalledTimes(1);
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
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should enable wait mode with timeout", () => {
      manager.enableWaitMode(500);

      expect(manager.isWaiting()).toBe(true);

      jest.advanceTimersByTime(500);

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
  });

  describe("reset", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
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

      // Start an update that would normally debounce
      updateCallback.mockClear();
      manager.updatePinMode(13, 0);

      manager.reset();

      jest.advanceTimersByTime(1000);

      // No callbacks should fire after reset
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
    it("should detect registry changes", () => {
      manager.startCollection();
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      updateCallback.mockClear();

      jest.useFakeTimers();

      // Change pin mode - should trigger update after debounce
      manager.updatePinMode(13, 0);

      // Should not send immediately (debouncing)
      expect(updateCallback).not.toHaveBeenCalled();

      // Wait for debounce to complete
      jest.advanceTimersByTime(200);

      expect(updateCallback).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
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
