// simulation-timeout-manager.test.ts
// Unit tests for SimulationTimeoutManager

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SimulationTimeoutManager } from "../../../server/services/simulation-timeout-manager";

describe("SimulationTimeoutManager", () => {
  let manager: SimulationTimeoutManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SimulationTimeoutManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schedule", () => {
    it("should schedule a timeout and execute callback", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(999);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not schedule timeout for null duration (infinite)", () => {
      const callback = vi.fn();
      manager.schedule(null, callback);

      vi.advanceTimersByTime(10000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should not schedule timeout for zero duration", () => {
      const callback = vi.fn();
      manager.schedule(0, callback);

      vi.advanceTimersByTime(10000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should clear previous timeout when scheduling new one", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.schedule(1000, callback1);
      vi.advanceTimersByTime(500);

      manager.schedule(1000, callback2);
      vi.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("pause and resume", () => {
    it("should pause timeout and calculate remaining time", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(300);
      const remaining = manager.pause();

      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
      expect(manager.isTimeoutPaused()).toBe(true);

      // Callback should not fire while paused
      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should resume timeout with exact remaining time", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(300);
      manager.pause();

      vi.advanceTimersByTime(500); // Time passes while paused

      manager.resume();

      // Should fire after ~700ms more (not affected by pause duration)
      vi.advanceTimersByTime(699);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple pause/resume cycles", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      // First pause/resume
      vi.advanceTimersByTime(200);
      manager.pause();
      vi.advanceTimersByTime(100);
      manager.resume();

      // Second pause/resume
      vi.advanceTimersByTime(300);
      manager.pause();
      vi.advanceTimersByTime(200);
      manager.resume();

      // Should fire after total of 500ms more (200 + 300 already elapsed)
      vi.advanceTimersByTime(499);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should ignore pause when not active", () => {
      const remaining = manager.pause();
      expect(remaining).toBeNull();
    });

    it("should ignore pause when already paused", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      manager.pause();
      const remaining = manager.pause();

      expect(remaining).toBeNull();
    });

    it("should ignore resume when not paused", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      const result = manager.resume();
      expect(result).toBe(false);
    });

    it("should fire callback immediately if resumed with no remaining time", () => {
      const callback = vi.fn();
      manager.schedule(100, callback);

      vi.advanceTimersByTime(100);
      manager.pause();

      const result = manager.resume();

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("clear", () => {
    it("should prevent zombie timers after clear", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      manager.clear();

      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should clear paused timeout", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(300);
      manager.pause();
      manager.clear();

      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.isTimeoutPaused()).toBe(false);
    });

    it("should be safe to call multiple times", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      manager.clear();
      manager.clear();
      manager.clear();

      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getRemainingMs", () => {
    it("should return remaining time for active timeout", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(300);
      const remaining = manager.getRemainingMs();

      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
    });

    it("should return paused remaining time when paused", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(300);
      manager.pause();

      vi.advanceTimersByTime(500); // Time passes while paused

      const remaining = manager.getRemainingMs();
      expect(remaining).toBeGreaterThanOrEqual(699);
      expect(remaining).toBeLessThanOrEqual(701);
    });

    it("should return null when no timeout is active", () => {
      const remaining = manager.getRemainingMs();
      expect(remaining).toBeNull();
    });

    it("should return null after timeout expires", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(1000);

      const remaining = manager.getRemainingMs();
      expect(remaining).toBeNull();
    });
  });

  describe("state queries", () => {
    it("should correctly report active state", () => {
      expect(manager.isTimeoutActive()).toBe(false);

      const callback = vi.fn();
      manager.schedule(1000, callback);
      expect(manager.isTimeoutActive()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(manager.isTimeoutActive()).toBe(false);
    });

    it("should correctly report paused state", () => {
      expect(manager.isTimeoutPaused()).toBe(false);

      const callback = vi.fn();
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
      const callback = vi.fn();
      const mgr = new SimulationTimeoutManager({ onTimeout: callback });

      mgr.schedule(1000, callback);
      vi.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should allow updating callback", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.schedule(1000, callback1);
      manager.setCallback(callback2);

      vi.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("precision and edge cases", () => {
    it("should handle very short timeouts", () => {
      const callback = vi.fn();
      manager.schedule(1, callback);

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle long timeouts", () => {
      const callback = vi.fn();
      manager.schedule(3600000, callback); // 1 hour

      vi.advanceTimersByTime(3599999);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not allow negative remaining time", () => {
      const callback = vi.fn();
      manager.schedule(100, callback);

      vi.advanceTimersByTime(200);
      const remaining = manager.getRemainingMs();

      // Timeout already fired, should be null (not negative)
      expect(remaining).toBeNull();
    });
  });

  describe("memory leak prevention", () => {
    it("should clear timer reference after expiration", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      vi.advanceTimersByTime(1000);

      // Internal state should be cleaned up
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.getRemainingMs()).toBeNull();
    });

    it("should clear timer reference after manual clear", () => {
      const callback = vi.fn();
      manager.schedule(1000, callback);

      manager.clear();

      // Internal state should be cleaned up
      expect(manager.isTimeoutActive()).toBe(false);
      expect(manager.getRemainingMs()).toBeNull();
    });
  });
});
