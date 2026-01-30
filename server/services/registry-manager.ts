// registry-manager.ts
// Manages I/O Registry for Arduino pin states with debouncing and change detection

import type { IOPinRecord } from "@shared/schema";
import { Logger } from "@shared/logger";

export interface RegistryUpdateCallback {
  (registry: IOPinRecord[], baudrate: number): void;
}

export interface RegistryManagerConfig {
  debounceMs?: number;
  onUpdate?: RegistryUpdateCallback;
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
  private lastSendTime = 0;
  private debounceTimer: NodeJS.Timeout | null = null;
  private waitTimer: NodeJS.Timeout | null = null;
  private waitingForRegistry = false;
  private baudrate = 9600;
  private destroyed = false; // Prevent logging after destruction
  private readonly logger = new Logger("RegistryManager");
  private readonly debounceMs: number;
  private readonly onUpdateCallback?: RegistryUpdateCallback;

  constructor(config: RegistryManagerConfig = {}) {
    this.debounceMs = config.debounceMs ?? 200;
    this.onUpdateCallback = config.onUpdate;
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
  }

  /**
   * Finish collecting and trigger debounced send (called when [[IO_REGISTRY_END]] marker is received)
   */
  finishCollection(): void {
    if (this.destroyed) return;
    this.logger.debug(
      `Registry collection complete: ${this.registry.length} pins`,
    );
    this.isCollecting = false;
    this.sendWithDebounce();
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

      this.sendWithDebounce();
    } else {
      // Create new pin record if not yet in registry
      this.registry.push({
        pin: pinStr,
        defined: true,
        pinMode: mode,
        usedAt: [{ line: 0, operation: `pinMode:${mode}` }],
      });
      this.sendWithDebounce();
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
  }

  /**
   * Update a pin's PWM value (called when [[PIN_PWM:pin:value]] is received)
   */
  updatePinPWM(pin: number, value: number): void {
    if (this.destroyed) return;
    // PWM updates don't modify registry structure, just track usage
    this.logger.debug(`Pin ${pin} PWM updated to ${value}`);
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
    this.lastSendTime = 0;
    this.waitingForRegistry = false;

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

    // Reset state without logging
    this.registry = [];
    this.isCollecting = false;
    this.registryHash = "";
    this.lastSendTime = 0;
    this.waitingForRegistry = false;
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
  private sendWithDebounce(): void {    if (this.destroyed) return;    if (!this.onUpdateCallback) {
      return;
    }

    const currentHash = this.calculateHash();
    const now = Date.now();
    const timeSinceLastSend = now - this.lastSendTime;

    // Check if registry content has changed
    if (currentHash === this.registryHash) {
      this.logger.debug("Registry unchanged - skipping send");
      return;
    }

    // First send (no hash set yet) - send immediately without debounce
    if (this.registryHash === "") {
      this.logger.debug(
        `First registry send (no debounce): ${this.registry.length} pins`,
      );
      this.sendNow(currentHash);

      // Release wait mode and clear timer
      this.waitingForRegistry = false;
      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
        this.waitTimer = null;
      }

      return;
    }

    // Subsequent sends - apply debounce (200ms default)
    if (timeSinceLastSend < this.debounceMs) {
      // Clear existing timer if any
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      // Schedule send after debounce period
      this.debounceTimer = setTimeout(() => {
        const latestHash = this.calculateHash();
        // Only send if hash is still different from last sent
        if (latestHash !== this.registryHash && this.onUpdateCallback) {
          this.logger.debug(
            `Registry send after debounce: ${this.registry.length} pins`,
          );
          this.sendNow(latestHash);
        }
        this.debounceTimer = null;
      }, this.debounceMs - timeSinceLastSend);

      return;
    }

    // Send immediately (enough time has passed since last send)
    this.logger.debug(
      `Registry send immediately: ${this.registry.length} pins`,
    );
    this.sendNow(currentHash);
  }

  /**
   * Immediately send the registry via callback
   */
  private sendNow(hash: string): void {
    this.registryHash = hash;
    this.lastSendTime = Date.now();

    if (this.onUpdateCallback) {
      this.onUpdateCallback([...this.registry], this.baudrate);
    }
  }

  /**
   * Calculate hash of registry data for change detection
   */
  private calculateHash(): string {
    return JSON.stringify(this.registry);
  }
}
