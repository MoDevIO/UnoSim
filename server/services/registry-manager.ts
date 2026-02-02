// registry-manager.ts
// Manages I/O Registry for Arduino pin states with debouncing and change detection

import type { IOPinRecord } from "@shared/schema";
import { Logger } from "@shared/logger";

export interface RegistryUpdateCallback {
  (registry: IOPinRecord[], baudrate: number): void;
}

export interface PerformanceMetrics {
  incomingEvents: number;
  sentBatches: number;
  eventsPerSecond: number;
  batchEfficiency: number; // average events per batch
  timestamp: number;
}

export interface TelemetryUpdateCallback {
  (metrics: PerformanceMetrics): void;
}

export interface RegistryManagerConfig {
  debounceMs?: number;
  onUpdate?: RegistryUpdateCallback;
  onTelemetry?: TelemetryUpdateCallback;
}

/**
 * RegistryManager handles the collection and management of Arduino pin states.
 * It provides debouncing to minimize WebSocket traffic and change detection
 * to avoid sending duplicate registry data.
 */
export class RegistryManager {
  private registry: IOPinRecord[] = [];
  private isCollecting = false;
  private registryHash = "";
  private debounceTimer: NodeJS.Timeout | null = null;
  private waitTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private waitingForRegistry = false;
  private isDirty = false;
  private baudrate = 9600;
  private destroyed = false; // Prevent logging after destruction
  private readonly logger = new Logger("RegistryManager");
  private readonly debounceMs: number;
  private readonly onUpdateCallback?: RegistryUpdateCallback;
  private readonly onTelemetryCallback?: TelemetryUpdateCallback;
  
  // Telemetry tracking
  private telemetry = {
    incomingEvents: 0,
    sentBatches: 0,
    lastReportTime: Date.now(),
  };

  constructor(config: RegistryManagerConfig = {}) {
    this.debounceMs = config.debounceMs ?? 200;
    this.onUpdateCallback = config.onUpdate;
    this.onTelemetryCallback = config.onTelemetry;
    
    // Start heartbeat if telemetry callback is provided
    if (this.onTelemetryCallback) {
      this.startHeartbeat();
    }
  }
  
  /**
   * Start 1-second heartbeat for telemetry reporting
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.destroyed) {
        const metrics = this.getPerformanceMetrics();
        if (this.onTelemetryCallback) {
          this.onTelemetryCallback(metrics);
        }
      }
    }, 1000);
  }
  
  /**
   * Calculate and return current performance metrics
   */
  private getPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();
    const timeElapsedMs = now - this.telemetry.lastReportTime;
    const timeElapsedSec = timeElapsedMs / 1000;
    
    const eventsPerSecond = timeElapsedSec > 0 
      ? Math.round((this.telemetry.incomingEvents / timeElapsedSec) * 10) / 10
      : 0;
    
    const batchEfficiency = this.telemetry.sentBatches > 0
      ? Math.round((this.telemetry.incomingEvents / this.telemetry.sentBatches) * 10) / 10
      : 0;
    
    const metrics: PerformanceMetrics = {
      incomingEvents: this.telemetry.incomingEvents,
      sentBatches: this.telemetry.sentBatches,
      eventsPerSecond,
      batchEfficiency,
      timestamp: now,
    };
    
    // Reset counters for next period
    this.telemetry.incomingEvents = 0;
    this.telemetry.sentBatches = 0;
    this.telemetry.lastReportTime = now;
    
    if (!this.destroyed) {
      this.logger.debug(
        `Telemetry: ${eventsPerSecond} evt/s, ${batchEfficiency} evt/batch, ${this.telemetry.sentBatches} batches`,
      );
    }
    
    return metrics;
  }

  /**
   * Start collecting registry data (called when [[IO_REGISTRY_START]] marker is received)
   */
  startCollection(): void {
    if (this.destroyed) return;
    this.logger.debug("Starting registry collection");
    this.isCollecting = true;
    this.registry = [];
  }

  /**
   * Add a pin record to the registry (called for each [[IO_PIN:...]] marker)
   */
  addPin(pinRecord: IOPinRecord): void {
    if (this.destroyed) return;
    if (!this.isCollecting) {
      this.logger.warn("Received pin record while not collecting - ignoring");
      return;
    }
    this.logger.debug(`Adding pin to registry: ${pinRecord.pin}`);
    this.registry.push(pinRecord);
    this.isDirty = true;
    this.telemetry.incomingEvents++;
  }

  /**
   * Finish collecting and send registry immediately (called when [[IO_REGISTRY_END]] marker is received)
   * Structural changes (new pins discovered) must reach UI immediately, not throttled.
   */
  finishCollection(): void {
    if (this.destroyed) return;
    this.logger.debug(
      `Registry collection complete: ${this.registry.length} pins`,
    );
    this.isCollecting = false;
    this.isDirty = true;
    this.sendNow("collection-complete");
    this.waitingForRegistry = false;
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  /**
   * Set the baudrate (parsed from Serial.begin() in user code)
   */
  setBaudrate(baudrate: number): void {
    if (this.destroyed) return;
    if (baudrate > 0 && baudrate !== this.baudrate) {
      this.logger.debug(`Baudrate updated: ${this.baudrate} -> ${baudrate}`);
      this.baudrate = baudrate;
    }
  }

  /**
   * Update a pin's mode at runtime (called when [[PIN_MODE:pin:mode]] is received)
   */
  updatePinMode(pin: number, mode: number): void {
    if (this.destroyed) return;
    const pinStr = pin >= 14 && pin <= 19 ? `A${pin - 14}` : String(pin);
    const existing = this.registry.find((p) => p.pin === pinStr);

    if (existing) {
      existing.pinMode = mode;
      existing.defined = true;

      // Track pinMode operation in usedAt
      const pinModeOp = `pinMode:${mode}`;
      if (!existing.usedAt) existing.usedAt = [];

      const alreadyTracked = existing.usedAt.some(
        (u) => u.operation === pinModeOp,
      );
      if (!alreadyTracked) {
        existing.usedAt.push({ line: 0, operation: pinModeOp });
      }
      this.isDirty = true;
      this.telemetry.incomingEvents++;
      this.sendNow("mode-updated");
    } else {
      // Create new pin record if not yet in registry
      this.registry.push({
        pin: pinStr,
        defined: true,
        pinMode: mode,
        usedAt: [{ line: 0, operation: `pinMode:${mode}` }],
      });
      this.isDirty = true;
      this.telemetry.incomingEvents++;
      this.sendNow("mode-updated");
    }
  }

  /**
   * Update a pin's digital value (called when [[PIN_VALUE:pin:value]] is received)
   */
  updatePinValue(pin: number, value: number): void {
    if (this.destroyed) return;
    // Pin value updates don't modify registry structure, just track usage
    // This could be extended to track value changes if needed
    this.logger.debug(`Pin ${pin} value updated to ${value}`);
    this.isDirty = true;
    this.telemetry.incomingEvents++;
    this.sendWithDebounce();
  }

  /**
   * Update a pin's PWM value (called when [[PIN_PWM:pin:value]] is received)
   * High-frequency updates are throttled to minimize WebSocket traffic
   */
  updatePinPWM(pin: number, value: number): void {
    if (this.destroyed) return;
    // PWM updates don't modify registry structure, just track usage
    this.logger.debug(`Pin ${pin} PWM updated to ${value}`);
    this.isDirty = true;
    this.telemetry.incomingEvents++;
    this.sendWithDebounce();
  }

  /**
   * Enable message queuing until first registry is sent
   */
  enableWaitMode(timeoutMs: number = 1500): void {
    if (this.destroyed) return;
    this.waitingForRegistry = true;

    // Set fallback timer to release queue if registry never arrives
    this.waitTimer = setTimeout(() => {
      if (this.waitingForRegistry) {
        this.logger.warn("Registry wait timeout - releasing queue");
        this.waitingForRegistry = false;
      }
    }, timeoutMs);
  }

  /**
   * Check if manager is currently waiting for first registry
   */
  isWaiting(): boolean {
    return this.waitingForRegistry;
  }

  /**
   * Reset the manager state (called when simulation stops)
   */
  reset(): void {
    this.registry = [];
    this.isCollecting = false;
    this.registryHash = "";
    this.waitingForRegistry = false;
    this.isDirty = false;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }

    if (!this.destroyed) {
      this.logger.debug("Registry manager reset");
    }
  }

  /**
   * Destroy the manager and prevent any further logging or callbacks
   * This is called during test teardown to prevent "log after tests are done" errors
   */
  destroy(): void {
    this.destroyed = true;
    
    // Clear all timers immediately
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Reset state without logging
    this.registry = [];
    this.isCollecting = false;
    this.registryHash = "";
    this.waitingForRegistry = false;
    this.isDirty = false;
  }

  /**
   * Get current registry snapshot
   */
  getRegistry(): readonly IOPinRecord[] {
    return [...this.registry];
  }

  /**
   * Send registry with debouncing and change detection
   */
  private sendWithDebounce(): void {
    if (this.destroyed) return;
    if (!this.onUpdateCallback) {
      return;
    }

    if (!this.isDirty) {
      this.logger.debug("Registry unchanged - skipping send");
      return;
    }

    // First send (no hash set yet) - send immediately without throttling
    if (this.registryHash === "") {
      this.logger.debug(
        `First registry send (no debounce): ${this.registry.length} pins`,
      );
      this.sendNow("init");

      // Release wait mode and clear timer
      this.waitingForRegistry = false;
      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
        this.waitTimer = null;
      }

      return;
    }

    // Throttle: if a timer is already running, do not reset it
    if (this.debounceTimer) {
      return;
    }

    this.debounceTimer = setTimeout(() => {
      if (this.onUpdateCallback && this.isDirty) {
        this.logger.debug(
          `Registry send after throttle: ${this.registry.length} pins`,
        );
        this.sendNow("throttled");
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  /**
   * Immediately send the registry via callback
   * Cancels any pending throttle timer to ensure structural changes reach UI immediately
   */
  private sendNow(hash: string): void {
    // Cancel any pending throttle timer to ensure immediate send
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.registryHash = hash;
    this.isDirty = false;
    this.telemetry.sentBatches++;

    if (this.onUpdateCallback) {
      this.onUpdateCallback([...this.registry], this.baudrate);
    }
  }

  /**
   * Legacy hash calculation removed in favor of isDirty flag
   */
}
