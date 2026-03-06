/**
 * Performance Benchmark for Event-Driven UnifiedGatekeeper
 * 
 * Demonstrates the elimination of polling overhead (O(n) -> O(1))
 * Tests with high contention scenarios (200+ concurrent waiters)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UnifiedGatekeeper } from "../../../server/services/unified-gatekeeper";

describe("UnifiedGatekeeper - Performance Benchmarks", () => {
  let gatekeeper: UnifiedGatekeeper;

  beforeEach(() => {
    gatekeeper = new UnifiedGatekeeper(4);
  });

  afterEach(() => {
    gatekeeper.stopLockMonitoring();
  });

  describe("Event-Driven Cache Lock Performance", () => {
    it("should handle 200 concurrent read lock waiters efficiently", async () => {
      const key = "high-contention-key";
      const numWaiters = 200;

      // Acquire a write lock to block all readers
      const writeLock = await gatekeeper.acquireCacheLock(key, "write", 60000, "initial-writer");

      // Queue 200 concurrent read lock requests
      const startTime = Date.now();
      const readerPromises = Array.from({ length: numWaiters }, (_, i) =>
        gatekeeper.acquireCacheLock(key, "read", 30000, `reader-${i}`)
      );

      // Release write lock after a short delay
      setTimeout(async () => {
        await writeLock();
      }, 100);

      // All readers should acquire locks (event-driven, no polling overhead)
      const readers = await Promise.all(readerPromises);
      const elapsedMs = Date.now() - startTime;

      // With event-driven approach, this should complete in ~100-500ms
      // With polling (25ms intervals), this would take much longer
      expect(elapsedMs).toBeLessThan(1000);
      expect(readers.length).toBe(numWaiters);

      // Cleanup
      for (const reader of readers) {
        await reader();
      }
    });

    it("should handle rapid lock acquire-release cycles without CPU spinning", async () => {
      const key = "rapid-cycle-key";
      const numCycles = 100;

      const startTime = Date.now();

      for (let i = 0; i < numCycles; i++) {
        const lock = await gatekeeper.acquireCacheLock(key, "write", 5000, `writer-${i}`);
        await lock();
      }

      const elapsedMs = Date.now() - startTime;

      // Event-driven should complete rapidly without spinning
      expect(elapsedMs).toBeLessThan(500);
    });

    it("should efficiently wake only relevant waiters (no thundering herd)", async () => {
      const key1 = "key1";
      const key2 = "key2";

      // Block both keys
      const write1 = await gatekeeper.acquireCacheLock(key1, "write", 60000, "w1");
      const write2 = await gatekeeper.acquireCacheLock(key2, "write", 60000, "w2");

      // Queue waiters on different keys
      const waitersKey1 = Array.from({ length: 50 }, (_, i) =>
        gatekeeper.acquireCacheLock(key1, "read", 30000, `r1-${i}`)
      );
      const waitersKey2 = Array.from({ length: 50 }, (_, i) =>
        gatekeeper.acquireCacheLock(key2, "read", 30000, `r2-${i}`)
      );

      // Release key1 - should only wake key1 waiters
      await write1();

      const readers1 = await Promise.all(waitersKey1);
      expect(readers1.length).toBe(50);

      // key2 waiters should still be waiting
      let key2Resolved = false;
      Promise.all(waitersKey2).then(() => {
        key2Resolved = true;
      });

      await new Promise(r => setTimeout(r, 100));
      expect(key2Resolved).toBe(false);

      // Release key2
      await write2();
      const readers2 = await Promise.all(waitersKey2);
      expect(readers2.length).toBe(50);

      // Cleanup
      for (const r of readers1) await r();
      for (const r of readers2) await r();
    });
  });

  describe("Compile Slot Event-Driven Architecture", () => {
    it("should handle 100 queued compile tasks efficiently", async () => {
      const gk = new UnifiedGatekeeper(2);
      const numTasks = 100;

      // Fill both slots
      const blocker1 = await gk.acquireCompileSlot();
      const blocker2 = await gk.acquireCompileSlot();

      // Queue 100 tasks
      const startTime = Date.now();
      const queuedTasks = Array.from({ length: numTasks }, (_, i) =>
        gk.acquireCompileSlot().then(release => {
          setTimeout(release, 1); // Quick release
        })
      );

      // Release blockers to start processing
      blocker1();
      blocker2();

      await Promise.all(queuedTasks);
      const elapsedMs = Date.now() - startTime;

      // Should complete rapidly without polling overhead
      expect(elapsedMs).toBeLessThan(2000);

      gk.stopLockMonitoring();
    });

    it("should emit slot_released events on release", async () => {
      const gk = new UnifiedGatekeeper(1);

      let eventCount = 0;
      gk.on("slot_released", () => {
        eventCount++;
      });

      const release = await gk.acquireCompileSlot();
      release();

      // Wait for event
      await new Promise(r => setTimeout(r, 10));

      expect(eventCount).toBe(1);

      gk.stopLockMonitoring();
    });
  });

  describe("Memory Efficiency - Event Listener Cleanup", () => {
    it("should remove event listeners on timeout", async () => {
      const key = "timeout-test-key";

      // Acquire write lock
      const writeLock = await gatekeeper.acquireCacheLock(key, "write", 60000, "blocker");

      // Try to acquire read lock with short timeout (should fail)
      let timeoutOccurred = false;
      try {
        await gatekeeper.acquireCacheLock(key, "read", 100, "timeout-victim");
      } catch {
        timeoutOccurred = true;
      }

      expect(timeoutOccurred).toBe(true);

      // Event listeners should be cleaned up (no memory leak)
      const listenerCount = gatekeeper.listenerCount(`cache_lock_released:${key}`);
      expect(listenerCount).toBe(0);

      await writeLock();
    });

    it("should cleanup all listeners on reset", async () => {
      const key = "reset-test";

      const writeLock = await gatekeeper.acquireCacheLock(key, "write", 60000, "w");

      // Queue some waiters
      gatekeeper.acquireCacheLock(key, "read", 60000, "r1").catch(() => {});
      gatekeeper.acquireCacheLock(key, "read", 60000, "r2").catch(() => {});

      await new Promise(r => setTimeout(r, 50));

      // Reset should cleanup listeners
      gatekeeper.reset();

      const totalListeners = gatekeeper.eventNames().length;
      expect(totalListeners).toBe(0);
    });
  });

  describe("Scalability under Load", () => {
    it("should maintain O(1) notification complexity with 500 waiters", async () => {
      const gk = new UnifiedGatekeeper(1);
      const key = "load-test";

      const writeLock = await gk.acquireCacheLock(key, "write", 120000, "blocker");

      // Queue 500 read lock waiters
      const waiters = Array.from({ length: 500 }, (_, i) =>
        gk.acquireCacheLock(key, "read", 60000, `load-reader-${i}`)
      );

      // Release write lock - all readers should be notified instantly (O(1) per reader)
      const releaseStartTime = Date.now();
      await writeLock();

      // All waiters should receive notification and acquire locks
      const readers = await Promise.all(waiters);
      const notificationTime = Date.now() - releaseStartTime;

      // Event-driven notification should be nearly instant
      // Polling would require multiple 25ms cycles
      expect(notificationTime).toBeLessThan(1000);
      expect(readers.length).toBe(500);

      // Cleanup
      for (const r of readers) await r();

      gk.stopLockMonitoring();
    });
  });
});
