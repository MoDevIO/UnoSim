// simulation-timeout-manager.test.ts
// Unit tests for SimulationTimeoutManager

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SimulationTimeoutManager } from "../../../server/services/simulation-timeout-manager";

describe("SimulationTimeoutManager", () => {
  let manager: SimulationTimeoutManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new SimulationTimeoutManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("schedule", () => {
    it("should schedule a timeout and execute callback", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(999);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not schedule timeout for null duration (infinite)", () => {
      const callback = jest.fn();
      manager.schedule(null, callback);

      jest.advanceTimersByTime(10000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should not schedule timeout for zero duration", () => {
      const callback = jest.fn();
      manager.schedule(0, callback);

      jest.advanceTimersByTime(10000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should clear previous timeout when scheduling new one", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      manager.schedule(1000, callback1);
      jest.advanceTimersByTime(500);

      manager.schedule(1000, callback2);
      jest.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("pause and resume", () => {
    it("should pause timeout and calculate remaining time", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(300);
      const remaining = manager.pause();

      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
      expect(manager.isTimeoutPaused()).toBe(true);

      // Callback should not fire while paused
      jest.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should resume timeout with exact remaining time", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(300);
      manager.pause();

      jest.advanceTimersByTime(500); // Time passes while paused

      manager.resume();

      // Should fire after ~700ms more (not affected by pause duration)
      jest.advanceTimersByTime(699);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple pause/resume cycles", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      // First pause/resume
      jest.advanceTimersByTime(200);
      manager.pause();
      jest.advanceTimersByTime(100);
      manager.resume();

      // Second pause/resume
      jest.advanceTimersByTime(300);
      manager.pause();
      jest.advanceTimersByTime(200);
      manager.resume();

      // Should fire after total of 500ms more (200 + 300 already elapsed)
      jest.advanceTimersByTime(499);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should ignore pause when not active", () => {
      const remaining = manager.pause();
      expect(remaining).toBeNull();
    });

    it("should ignore pause when already paused", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      manager.pause();
      const remaining = manager.pause();

      expect(remaining).toBeNull();
    });

    it("should ignore resume when not paused", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      const result = manager.resume();
      expect(result).toBe(false);
    });

    it("should fire callback immediately if resumed with no remaining time", () => {
      const callback = jest.fn();
      manager.schedule(100, callback);

      jest.advanceTimersByTime(100);
      manager.pause();

      const result = manager.resume();

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("clear", () => {
    it("should prevent zombie timers after clear", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      manager.clear();

      jest.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should clear paused timeout", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(300);
      manager.pause();
      manager.clear();

      jest.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.isTimeoutPaused()).toBe(false);
    });

    it("should be safe to call multiple times", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      manager.clear();
      manager.clear();
      manager.clear();

      jest.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getRemainingMs", () => {
    it("should return remaining time for active timeout", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(300);
      const remaining = manager.getRemainingMs();

      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
    });

    it("should return paused remaining time when paused", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(300);
      manager.pause();

      jest.advanceTimersByTime(500); // Time passes while paused

      const remaining = manager.getRemainingMs();
      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
    });

    it("should return null when no timeout is active", () => {
      const remaining = manager.getRemainingMs();
      expect(remaining).toBeNull();
    });

    it("should return null after timeout expires", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(1000);

      const remaining = manager.getRemainingMs();
      expect(remaining).toBeNull();
    });
  });

  describe("state queries", () => {
    it("should correctly report active state", () => {
      expect(manager.isTimeoutActive()).toBe(false);

      const callback = jest.fn();
      manager.schedule(1000, callback);
      expect(manager.isTimeoutActive()).toBe(true);

      jest.advanceTimersByTime(1000);
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should correctly report paused state", () => {
      expect(manager.isTimeoutPaused()).toBe(false);

      const callback = jest.fn();
      manager.schedule(1000, callback);
      expect(manager.isTimeoutPaused()).toBe(false);

      manager.pause();
      expect(manager.isTimeoutPaused()).toBe(true);

      manager.resume();
      expect(manager.isTimeoutPaused()).toBe(false);
    });
  });

  describe("callback management", () => {
    it("should use callback from constructor config", () => {
      const callback = jest.fn();
      const mgr = new SimulationTimeoutManager({ onTimeout: callback });

      mgr.schedule(1000, callback);
      jest.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should allow updating callback", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      manager.schedule(1000, callback1);
      manager.setCallback(callback2);

      jest.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("precision and edge cases", () => {
    it("should handle very short timeouts", () => {
      const callback = jest.fn();
      manager.schedule(1, callback);

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle long timeouts", () => {
      const callback = jest.fn();
      manager.schedule(3600000, callback); // 1 hour

      jest.advanceTimersByTime(3599999);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not allow negative remaining time", () => {
      const callback = jest.fn();
      manager.schedule(100, callback);

      jest.advanceTimersByTime(200);
      const remaining = manager.getRemainingMs();

      // Timeout already fired, should be null (not negative)
      expect(remaining).toBeNull();
    });
  });

  describe("memory leak prevention", () => {
    it("should clear timer reference after expiration", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      jest.advanceTimersByTime(1000);

      // Internal state should be cleaned up
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.getRemainingMs()).toBeNull();
    });

    it("should clear timer reference after manual clear", () => {
      const callback = jest.fn();
      manager.schedule(1000, callback);

      manager.clear();

      // Internal state should be cleaned up
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.getRemainingMs()).toBeNull();
    });
  });
});
