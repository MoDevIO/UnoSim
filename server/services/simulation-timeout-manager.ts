// simulation-timeout-manager.ts
// Manages simulation execution timeout with pause/resume support

import { Logger } from "@shared/logger";

interface TimeoutCallback {
  (): void;
}

interface SimulationTimeoutManagerConfig {
  onTimeout?: TimeoutCallback;
}

/**
 * SimulationTimeoutManager handles execution timeout logic with pause/resume support.
 * Ensures no zombie timers remain after stop() and correctly calculates remaining time.
 */
export class SimulationTimeoutManager {
  private timeoutHandle: NodeJS.Timeout | null = null;
  private timeoutDeadlineMs: number | null = null;
  private pausedRemainingMs: number | null = null;
  private callback: TimeoutCallback | null = null;
  private isPaused = false;
  private isActive = false;
  private readonly logger = new Logger("TimeoutManager");

  constructor(config: SimulationTimeoutManagerConfig = {}) {
    if (config.onTimeout) {
      this.callback = config.onTimeout;
    }
  }

  /**
   * Schedule a timeout with the given duration in milliseconds.
   * If timeoutMs is null, no timeout is scheduled (infinite execution).
   *
   * @param timeoutMs - Timeout duration in milliseconds, or null for infinite
   * @param callback - Callback to execute when timeout occurs
   */
  schedule(timeoutMs: number | null, callback: TimeoutCallback): void {
    // Clear any existing timeout first
    this.clear();

    if (timeoutMs === null || timeoutMs <= 0) {
      this.logger.debug("No timeout scheduled (infinite execution)");
      return;
    }

    this.callback = callback;
    this.timeoutDeadlineMs = Date.now() + timeoutMs;
    this.isActive = true;
    this.isPaused = false;

    this.timeoutHandle = setTimeout(() => {
      this.logger.debug("Timeout reached - executing callback");
      this.isActive = false;
      this.timeoutHandle = null;

      if (this.callback) {
        this.callback();
      }
    }, timeoutMs);

    this.logger.debug(
      `Timeout scheduled: ${timeoutMs}ms (deadline: ${this.timeoutDeadlineMs})`,
    );
  }

  /**
   * Pause the timeout clock. Calculates and stores remaining time.
   * Returns the remaining time in milliseconds, or null if no timeout is active.
   */
  pause(): number | null {
    if (!this.isActive || this.isPaused) {
      this.logger.debug("Pause ignored - not active or already paused");
      return null;
    }

    if (!this.timeoutDeadlineMs) {
      this.logger.debug("Pause ignored - no deadline set");
      return null;
    }

    // Calculate remaining time before clearing timer
    const now = Date.now();
    const remaining = Math.max(0, this.timeoutDeadlineMs - now);
    this.pausedRemainingMs = remaining;
    this.isPaused = true;

    // Clear the active timer to stop it from firing
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    this.logger.debug(`Timeout paused - ${remaining}ms remaining`);
    return remaining;
  }

  /**
   * Resume the timeout clock with the remaining time.
   * Returns true if resume was successful, false otherwise.
   */
  resume(): boolean {
    if (!this.isActive || !this.isPaused) {
      this.logger.debug("Resume ignored - not active or not paused");
      return false;
    }

    if (this.pausedRemainingMs === null || this.pausedRemainingMs <= 0) {
      this.logger.debug("Resume ignored - no remaining time");
      // Timeout already expired
      if (this.callback) {
        this.callback();
      }
      this.clear();
      return false;
    }

    const remainingMs = this.pausedRemainingMs;
    this.pausedRemainingMs = null;
    this.isPaused = false;

    // Schedule new timeout with remaining time
    this.timeoutDeadlineMs = Date.now() + remainingMs;
    this.timeoutHandle = setTimeout(() => {
      this.logger.debug("Timeout reached after resume - executing callback");
      this.isActive = false;
      this.timeoutHandle = null;

      if (this.callback) {
        this.callback();
      }
    }, remainingMs);

    this.logger.debug(`Timeout resumed - ${remainingMs}ms remaining`);
    return true;
  }

  /**
   * Stop and clear the timeout. Prevents any zombie timers.
   * This is the critical method for preventing memory leaks.
   */
  clear(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
      this.logger.debug("Timeout cleared");
    }

    this.timeoutDeadlineMs = null;
    this.pausedRemainingMs = null;
    this.isActive = false;
    this.isPaused = false;
    // Note: We keep the callback reference for reuse
  }

  /**
   * Get the remaining time in milliseconds.
   * Returns null if no timeout is active.
   */
  getRemainingMs(): number | null {
    if (!this.isActive) {
      return null;
    }

    if (this.isPaused) {
      return this.pausedRemainingMs;
    }

    if (!this.timeoutDeadlineMs) {
      return null;
    }

    const now = Date.now();
    return Math.max(0, this.timeoutDeadlineMs - now);
  }

  /**
   * Check if timeout is currently active (scheduled and not expired).
   */
  isTimeoutActive(): boolean {
    return this.isActive;
  }

  /**
   * Check if timeout is currently paused.
   */
  isTimeoutPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Update the timeout callback.
   */
  setCallback(callback: TimeoutCallback): void {
    this.callback = callback;
  }
}
