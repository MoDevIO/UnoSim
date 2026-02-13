/**
 * Unit Tests for SerialCharacterRenderer
 * 
 * Tests the core renderer logic in isolation (no React dependencies)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SerialCharacterRenderer } from "@/utils/serial-character-renderer";

describe("SerialCharacterRenderer - Unit Tests", () => {
  let renderer: SerialCharacterRenderer;
  let capturedOutput: string[];
  let onChar: (char: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedOutput = [];
    onChar = (char: string) => capturedOutput.push(char);
    renderer = new SerialCharacterRenderer(onChar);
    
    // Mock requestAnimationFrame to use setTimeout behavior
    global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0) as unknown as number);
    global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id as unknown as NodeJS.Timeout));
  });

  afterEach(() => {
    renderer.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Basic Functionality", () => {
    it("should enqueue data and start rendering", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("A");
      
      expect(renderer.getQueueLength()).toBe(1);
      expect(renderer.isActive()).toBe(true);
    });

    it("should render character after calculated delay at 9600 baud", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("Hello");
      
      // At 9600 baud: 960 bytes/s = 1.04ms per char
      // Advance by 1ms and run all timers
      vi.advanceTimersByTime(1);
      vi.runAllTimers();
      
      // Should have rendered at least 1 character
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput.join("")).toContain("H");
    });

    it("should render all characters eventually", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("Test");
      
      // Wait long enough for all 4 characters (4 × 1.04ms ≈ 5ms)
      vi.advanceTimersByTime(10);
      vi.runAllTimers();
      
      expect(capturedOutput.join("")).toBe("Test");
      expect(renderer.getQueueLength()).toBe(0);
      expect(renderer.isActive()).toBe(false);
    });

    it("should render immediately when baudrate is undefined", () => {
      renderer.setBaudrate(undefined);
      renderer.enqueue("Immediate");
      
      // Should render on next RAF
      vi.advanceTimersByTime(0);
      vi.runAllTimers();
      
      expect(capturedOutput.join("")).toBe("Immediate");
      expect(renderer.getQueueLength()).toBe(0);
    });
  });

  describe("Baudrate Calculation", () => {
    it("should render slower at 300 baud (~33ms/char)", () => {
      renderer.setBaudrate(300);
      renderer.enqueue("AB");
      
      // After 30ms: Should have rendered 1 char
      vi.advanceTimersByTime(30);
      vi.runAllTimers();
      expect(capturedOutput.length).toBeGreaterThanOrEqual(1);
      
      // After 70ms: Should have rendered both
      vi.advanceTimersByTime(40);
      vi.runAllTimers();
      expect(capturedOutput.join("")).toBe("AB");
    });

    it("should render faster at 115200 baud (< 0.1ms/char)", () => {
      renderer.setBaudrate(115200);
      renderer.enqueue("FastData");
      
      // At 115200: 11520 bytes/s = 0.087ms per char (batched due to < 1ms)
      vi.advanceTimersByTime(2);
      vi.runAllTimers();
      
      // All should be rendered due to batching
      expect(capturedOutput.join("")).toBe("FastData");
    });
  });

  describe("Pause/Resume", () => {
    it("should pause rendering and stop RAF loop", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("PauseTest");
      
      // Render 1 char
      vi.advanceTimersByTime(1);
      const afterFirst = capturedOutput.join("");
      
      // Pause
      renderer.pause();
      expect(renderer.isActive()).toBe(false);
      
      // Time passes but nothing happens
      vi.advanceTimersByTime(100);
      expect(capturedOutput.join("")).toBe(afterFirst); // No change
    });

    it("should resume rendering from where it paused", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("ResumeTest");
      
      vi.advanceTimersByTime(2);
      const afterPause = capturedOutput.join("");
      
      renderer.pause();
      vi.advanceTimersByTime(100);
      
      // Resume
      renderer.resume();
      vi.advanceTimersByTime(20);
      
      const afterResume = capturedOutput.join("");
      expect(afterResume.length).toBeGreaterThan(afterPause.length);
    });
  });

  describe("Clear", () => {
    it("should clear queue and stop rendering", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("ClearMe");
      
      vi.advanceTimersByTime(1);
      
      renderer.clear();
      
      expect(renderer.getQueueLength()).toBe(0);
      expect(renderer.isActive()).toBe(false);
      
      // Output captured before clear stays
      const outputBeforeClear = capturedOutput.join("");
      
      vi.advanceTimersByTime(100);
      
      // No additional output after clear
      expect(capturedOutput.join("")).toBe(outputBeforeClear);
    });
  });

  describe("Multiple Enqueues ", () => {
    it("should queue multiple chunks sequentially", () => {
      renderer.setBaudrate(9600);
      
      renderer.enqueue("First");
      vi.advanceTimersByTime(2);
      vi.runAllTimers();
      
      renderer.enqueue("Second");
      vi.advanceTimersByTime(10);
      vi.runAllTimers();
      
      expect(capturedOutput.join("")).toBe("FirstSecond");
    });
  });

  describe("Baudrate Change During Rendering", () => {
    it("should adapt to baudrate change mid-rendering", () => {
      renderer.setBaudrate(300); // Slow
      renderer.enqueue("SlowFast");
      
      // Render ~2 chars at 300 baud (66ms)
      vi.advanceTimersByTime(66);
      const afterSlow = capturedOutput.join("");
      
      // Change to fast baudrate
      renderer.setBaudrate(115200);
      
      // Rest should render quickly
      vi.advanceTimersByTime(5);
      
      const afterFast = capturedOutput.join("");
      expect(afterFast).toBe("SlowFast");
      expect(afterSlow.length).toBeLessThan(afterFast.length);
    });
  });

  describe("Memory Limits", () => {
    it("should enforce MAX_QUEUE_SIZE and drop oldest chars", () => {
      renderer.setBaudrate(9600);
      
      // Enqueue 60k chars (exceeds 50k limit)
      const hugeData = "X".repeat(60000);
      renderer.enqueue(hugeData);
      
      // Should be capped at 50k
      expect(renderer.getQueueLength()).toBeLessThanOrEqual(50000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty enqueue", () => {
      renderer.enqueue("");
      expect(renderer.getQueueLength()).toBe(0);
      expect(renderer.isActive()).toBe(false);
    });

    it("should handle very long single message", () => {
      renderer.setBaudrate(115200);
      const longMsg = "A".repeat(10000);
      renderer.enqueue(longMsg);
      
      vi.advanceTimersByTime(100);
      vi.runAllTimers();
      
      // Should render all due to high baudrate batching
      expect(capturedOutput.join("").length).toBe(10000);
    });

    it("should not crash when cleared multiple times", () => {
      renderer.clear();
      renderer.clear();
      renderer.clear();
      
      expect(renderer.getQueueLength()).toBe(0);
    });

    it("should handle pause when not active", () => {
      renderer.pause();
      expect(renderer.isActive()).toBe(false);
    });

    it("should handle resume when already active", () => {
      renderer.setBaudrate(9600);
      renderer.enqueue("Test");
      renderer.resume(); // Should be no-op
      
      vi.advanceTimersByTime(10);
      expect(capturedOutput.join("")).toBe("Test");
    });
  });
});
