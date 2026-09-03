import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimulationRateLimiter } from "../../../server/services/rate-limiter";

describe("SimulationRateLimiter", () => {
  let rateLimiter: SimulationRateLimiter;
  const identity1 = "student-1";
  const identity2 = "student-2";
  const mockWs1 = identity1;
  const mockWs2 = identity2;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Create new instance with short test intervals
    rateLimiter = SimulationRateLimiter.getInstance({
      maxRequests: 1,
      windowMs: 2000,
      blockDurationMs: 5000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    rateLimiter.destroy();
    // @ts-ignore - Reset singleton for next test
    SimulationRateLimiter.instance = null;
  });

  it("should allow first request from new client", () => {
    const result = rateLimiter.checkLimit(identity1);

    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  it("should block second request within window", () => {
    // First request
    rateLimiter.checkLimit(identity1);

    // Second request immediately after (within 2000ms window)
    vi.advanceTimersByTime(500);
    const result = rateLimiter.checkLimit(identity1);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("should allow request after window expires", () => {
    // First request
    rateLimiter.checkLimit(identity1);

    // Wait for window to expire (2000ms + 100ms buffer)
    vi.advanceTimersByTime(2100);
    
    const result = rateLimiter.checkLimit(identity1);

    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  it("should keep client blocked for block duration", () => {
    // First request (allowed)
    rateLimiter.checkLimit(mockWs1);

    // Second request (triggers block)
    vi.advanceTimersByTime(500);
    const blockedResult = rateLimiter.checkLimit(mockWs1);
    expect(blockedResult.allowed).toBe(false);

    // Try again after 3 seconds (still within 5s block)
    vi.advanceTimersByTime(3000);
    const stillBlockedResult = rateLimiter.checkLimit(mockWs1);
    expect(stillBlockedResult.allowed).toBe(false);

    // After block expires (6s total)
    vi.advanceTimersByTime(3000);
    const unblockedResult = rateLimiter.checkLimit(mockWs1);
    expect(unblockedResult.allowed).toBe(true);
  });

  it("should handle multiple clients independently", () => {
    // Client 1 makes request
    const result1 = rateLimiter.checkLimit(mockWs1);
    expect(result1.allowed).toBe(true);

    // Client 2 makes request (should be allowed, different client)
    const result2 = rateLimiter.checkLimit(mockWs2);
    expect(result2.allowed).toBe(true);

    // Client 1 tries again (should be blocked)
    vi.advanceTimersByTime(500);
    const result1Again = rateLimiter.checkLimit(mockWs1);
    expect(result1Again.allowed).toBe(false);

    // Client 2 tries again (should also be blocked)
    const result2Again = rateLimiter.checkLimit(mockWs2);
    expect(result2Again.allowed).toBe(false);
  });

  it("should retain a limit across a reconnect with the same identity", () => {
    rateLimiter.checkLimit(mockWs1);
    const reconnectedSocketIdentity = `${mockWs1}`;
    vi.advanceTimersByTime(500);

    expect(rateLimiter.checkLimit(reconnectedSocketIdentity)).toEqual({
      allowed: false,
      retryAfter: 5,
    });
    expect(rateLimiter.getStats().activeClients).toBe(1);
  });

  it("should calculate correct retryAfter in seconds", () => {
    // First request
    rateLimiter.checkLimit(mockWs1);

    // Second request triggers block (5000ms = 5s)
    vi.advanceTimersByTime(500);
    const result = rateLimiter.checkLimit(mockWs1);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(5); // 5 seconds

    // Advance 2 seconds
    vi.advanceTimersByTime(2000);
    const result2 = rateLimiter.checkLimit(mockWs1);
    expect(result2.allowed).toBe(false);
    expect(result2.retryAfter).toBe(3); // 3 seconds remaining
  });

  it("should provide correct stats", () => {
    rateLimiter.checkLimit(mockWs1);
    rateLimiter.checkLimit(mockWs2);

    // Block both clients
    vi.advanceTimersByTime(500);
    rateLimiter.checkLimit(mockWs1);
    rateLimiter.checkLimit(mockWs2);

    const stats = rateLimiter.getStats();

    expect(stats.activeClients).toBe(2);
    expect(stats.blockedClients).toBe(2);
    expect(stats.config.maxRequests).toBe(1);
    expect(stats.config.windowMs).toBe(2000);
    expect(stats.config.blockDurationMs).toBe(5000);
  });

  it("should keep recently active identities during cleanup", () => {
    rateLimiter.checkLimit(mockWs1);
    rateLimiter.checkLimit(mockWs2);

    expect(rateLimiter.getStats().activeClients).toBe(2);

    // Trigger cleanup interval (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    const stats = rateLimiter.getStats();
    expect(stats.activeClients).toBe(2);
  });

  it("should cleanup clients inactive for 10 minutes", () => {
    rateLimiter.checkLimit(mockWs1);

    expect(rateLimiter.getStats().activeClients).toBe(1);

    // Simulate 10 minutes + cleanup interval
    vi.advanceTimersByTime(10 * 60 * 1000 + 5 * 60 * 1000 + 1000);

    const stats = rateLimiter.getStats();
    expect(stats.activeClients).toBe(0);
  });

  it("should return singleton instance", () => {
    const instance1 = SimulationRateLimiter.getInstance();
    const instance2 = SimulationRateLimiter.getInstance();

    expect(instance1).toBe(instance2);
  });

  it("should clear interval on destroy", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    
    rateLimiter.destroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(rateLimiter.getStats().activeClients).toBe(0);
  });

  it("should reset block after block duration expires", () => {
    // Trigger block
    rateLimiter.checkLimit(mockWs1);
    vi.advanceTimersByTime(500);
    const blockedResult = rateLimiter.checkLimit(mockWs1);
    expect(blockedResult.allowed).toBe(false);

    // Wait for block to expire (5s)
    vi.advanceTimersByTime(5500);

    // Next request should be allowed (timestamps cleared)
    const result = rateLimiter.checkLimit(mockWs1);
    expect(result.allowed).toBe(true);

    const stats = rateLimiter.getStats();
    expect(stats.blockedClients).toBe(0);
  });
});
