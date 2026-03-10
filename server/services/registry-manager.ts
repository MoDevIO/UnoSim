// registry-manager.ts
// Manages I/O Registry for Arduino pin states with debouncing and change detection

import type { IOPinRecord } from "@shared/schema";
import type { PinStateBatcher } from "./pin-state-batcher";
import type { SerialOutputBatcher, SerialOutputTelemetry } from "./serial-output-batcher";
import { Logger } from "@shared/logger";
import { createWriteStream, type WriteStream } from "fs";
import { join } from "path";

export interface RegistryUpdateCallback {
  (registry: IOPinRecord[], baudrate: number | undefined, reason?: string): void;
}

export interface PerformanceMetrics {
  timestamp: number;
  intendedPinChangesPerSecond: number;
  actualPinChangesPerSecond: number;
  droppedPinChangesPerSecond: number;
  batchesPerSecond: number;
  avgStatesPerBatch: number;
  serialOutputPerSecond: number;
  serialBytesPerSecond: number;
  serialBytesTotal: number;
  serialIntendedBytesPerSecond: number;
  serialDroppedBytesPerSecond: number;
}

export interface TelemetryUpdateCallback {
  (metrics: PerformanceMetrics): void;
}

export interface RegistryManagerConfig {
  onUpdate?: RegistryUpdateCallback;
  onTelemetry?: TelemetryUpdateCallback;
  enableTelemetry?: boolean;
}

/**
 * Helper to clean up pin record by removing line: 0 from usedAt/definedAt
 */
function cleanupPinRecord(pin: IOPinRecord): IOPinRecord {
  const cleaned = { ...pin };
  
  // Remove definedAt if line is 0
  if (cleaned.definedAt?.line === 0) {
    delete (cleaned as any).definedAt;
  }
  
  // Filter out usedAt entries with line: 0 that have no operation (true placeholders).
  // Runtime entries always have line: 0 but carry a non-empty operation string
  // (e.g. "pinMode:0") – those must be preserved so the client can detect conflicts.
  if (cleaned.usedAt && cleaned.usedAt.length > 0) {
    cleaned.usedAt = cleaned.usedAt.filter(
      entry => entry.line !== 0 || !!entry.operation,
    );
    // Remove usedAt entirely if empty
    if (cleaned.usedAt.length === 0) {
      delete (cleaned as any).usedAt;
    }
  }
  
  return cleaned;
}

function mergeUsedAtEntries(
  existing: IOPinRecord["usedAt"],
  incoming: IOPinRecord["usedAt"],
): IOPinRecord["usedAt"] {
  const merged = [...(existing ?? []), ...(incoming ?? [])];
  if (merged.length === 0) return undefined;

  const unique = new Map<string, (typeof merged)[number]>();
  for (const entry of merged) {
    const key = `${entry.operation}@${entry.line}`;
    if (!unique.has(key)) {
      unique.set(key, entry);
    }
  }
  return Array.from(unique.values());
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
  private baudrate: number | undefined = undefined; // undefined = Serial.begin() not found in code
  private destroyed = false; // Prevent logging after destruction
  private debugStream: WriteStream | null = null; // Non-blocking telemetry stream
  /**
   * Anti-spam: tracks (pin, mode) pairs already sent via updatePinMode so that
   * repeated calls (e.g. from loop()) never trigger a redundant WS message.
   * Keyed as "<pinId>:<mode>" (e.g. "13:1").
   * Reset on reset() / next program start.
   */
  private runtimeSentFingerprints = new Set<string>();
  private readonly logger = new Logger("RegistryManager");
  private readonly onUpdateCallback?: RegistryUpdateCallback;
  private readonly onTelemetryCallback?: TelemetryUpdateCallback;
  private readonly enableTelemetry: boolean;
  private pinStateBatcher: PinStateBatcher | null = null; // Reference to PinStateBatcher for telemetry
  private serialOutputBatcher: SerialOutputBatcher | null = null; // Reference to SerialOutputBatcher for telemetry
  
  // Telemetry tracking
  private telemetry = {
    incomingEvents: 0,
    sentBatches: 0,
    serialOutputEvents: 0, // track serial output events
    serialOutputBytes: 0, // bytes in current interval
    serialOutputBytesTotal: 0, // cumulative bytes since start
    // timestamp at which the simulation was paused (if any)
    pauseTimestamp: null as number | null,
    lastReportTime: Date.now(),
  };

  constructor(config: RegistryManagerConfig = {}) {
    this.onUpdateCallback = config.onUpdate;
    this.onTelemetryCallback = config.onTelemetry;
    this.enableTelemetry = config.enableTelemetry ?? false;
    
    // Telemetry heartbeat starts only when simulation is running
  }
  
  /**
   * Set reference to PinStateBatcher for telemetry tracking
   */
  setPinStateBatcher(batcher: PinStateBatcher | null): void {
    this.pinStateBatcher = batcher;
  }
  
  /**
   * Set reference to SerialOutputBatcher for telemetry tracking
   */
  setSerialOutputBatcher(batcher: SerialOutputBatcher | null): void {
    this.serialOutputBatcher = batcher;
  }
  
  /**
   * Start 1-second heartbeat for telemetry reporting
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
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
   * Stop telemetry heartbeat and clear interval
   */
  private stopTelemetry(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Pause telemetry heartbeat (called when simulation is paused)
   * Stops sending telemetry data while paused
   */
  pauseTelemetry(): void {
    this.stopTelemetry();
  }

  /**
   * Inform the manager of the exact timestamp when the simulation was paused.
   * This allows any subsequent events (e.g. those buffered in OS pipes) to be
   * labelled with a correct 'pause' time rather than the later resume time.
   *
   * The current implementation simply stores the value for future use; the
   * consuming code may choose how to apply it. See usages in
   * SandboxRunner.pause()/resume().
   */
  markPauseTime(ts: number | null): void {
    this.telemetry.pauseTimestamp = ts;
  }

  /**
   * Resume telemetry heartbeat (called when simulation is resumed)
   * Resets counters and restarts the heartbeat
   */
  resumeTelemetry(): void {
    if (this.onTelemetryCallback && this.enableTelemetry) {
      // Reset timestamp for fresh start after pause
      this.telemetry.lastReportTime = Date.now();
      this.startHeartbeat();
    }
  }
  
  /**
   * Calculate and return current performance metrics
   */
  private getPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();
    const timeElapsedMs = now - this.telemetry.lastReportTime;
    const timeElapsedSec = timeElapsedMs / 1000;

    // Get pin change telemetry from PinStateBatcher
    let intendedPinChangesPerSecond = 0;
    let actualPinChangesPerSecond = 0;
    let droppedPinChangesPerSecond = 0;
    let batchesPerSecond = 0;
    let avgStatesPerBatch = 0;

    if (this.pinStateBatcher) {
      const batcherTelemetry = this.pinStateBatcher.getTelemetryAndReset();
      
      intendedPinChangesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.intended / timeElapsedSec) * 10) / 10
        : 0;
      
      actualPinChangesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.actual / timeElapsedSec) * 10) / 10
        : 0;
      
      droppedPinChangesPerSecond = intendedPinChangesPerSecond - actualPinChangesPerSecond;
      
      batchesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.batches / timeElapsedSec) * 10) / 10
        : 0;
      
      avgStatesPerBatch = batcherTelemetry.batches > 0
        ? Math.round((batcherTelemetry.actual / batcherTelemetry.batches) * 10) / 10
        : 0;
    }

    // Get serial output telemetry from SerialOutputBatcher
    let serialOutputPerSecond = 0;
    let serialBytesPerSecond = 0;
    let serialIntendedBytesPerSecond = 0;
    let serialDroppedBytesPerSecond = 0;
    let serialBytesTotal = this.telemetry.serialOutputBytesTotal; // Fallback for no batcher
    let batcherTelemetry: SerialOutputTelemetry | null = null;

    if (this.serialOutputBatcher) {
      batcherTelemetry = this.serialOutputBatcher.getTelemetryAndReset();
      
      // Serial events = number of chunks sent (batch outputs)
      serialOutputPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.chunks / timeElapsedSec) * 10) / 10
        : 0;
      
      // Serial bytes = actual bytes sent after rate limiting
      serialBytesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.actual / timeElapsedSec) * 10) / 10
        : 0;
      
      // Intended bytes = total bytes enqueued (before drops)
      serialIntendedBytesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.intended / timeElapsedSec) * 10) / 10
        : 0;
      
      // Dropped bytes per second
      serialDroppedBytesPerSecond = timeElapsedSec > 0
        ? Math.round((batcherTelemetry.dropped / timeElapsedSec) * 10) / 10
        : 0;
      
      // Total bytes from batcher (cumulative, never reset)
      serialBytesTotal = batcherTelemetry.totalBytes;
    }

    const metrics: PerformanceMetrics = {
      timestamp: now,
      intendedPinChangesPerSecond,
      actualPinChangesPerSecond,
      droppedPinChangesPerSecond,
      batchesPerSecond,
      avgStatesPerBatch,
      serialOutputPerSecond,
      serialBytesPerSecond,
      serialBytesTotal, // Now from SerialOutputBatcher
      serialIntendedBytesPerSecond,
      serialDroppedBytesPerSecond,
    };

    // Reset counters for next period
    this.telemetry.incomingEvents = 0;
    this.telemetry.sentBatches = 0;
    this.telemetry.serialOutputEvents = 0;
    this.telemetry.serialOutputBytes = 0;
    this.telemetry.lastReportTime = now;

    if (!this.destroyed) {
      this.logger.debug(
        `Telemetry: intended: ${intendedPinChangesPerSecond} pin/s, actual: ${actualPinChangesPerSecond} pin/s (dropped: ${droppedPinChangesPerSecond}), ${batchesPerSecond} bat/s, ${avgStatesPerBatch} st/bat, ${serialOutputPerSecond} serial/s, SERIAL: intended=${batcherTelemetry?.intended ?? 0} bytes, actual=${batcherTelemetry?.actual ?? 0} bytes, dropped=${batcherTelemetry?.dropped ?? 0} bytes (${serialDroppedBytesPerSecond} B/s)`,
      );

      if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
        // DEBUG: Write telemetry to file for inspection
        try {
          const debugPath = join(process.cwd(), "temp", "telemetry-debug.jsonl");
          const debugLine = JSON.stringify({
            timestamp: new Date(now).toISOString(),
            serial: {
              outputPerSec: serialOutputPerSecond,
              bytesPerSec: serialBytesPerSecond,
              intendedPerSec: serialIntendedBytesPerSecond,
              intendedBytes: batcherTelemetry?.intended ?? 0,
              actualBytes: batcherTelemetry?.actual ?? 0,
              droppedBytes: batcherTelemetry?.dropped ?? 0,
              droppedPerSec: serialDroppedBytesPerSecond,
              bytesTotal: serialBytesTotal,
            },
          }) + "\n";
          // Non-blocking write via stream
          if (!this.debugStream) {
            this.debugStream = createWriteStream(debugPath, { flags: "a" });
          }
          this.debugStream.write(debugLine);
        } catch {
          // Silently ignore file write errors
        }
      }
    }

    return metrics;
  }

  /**
   * Start collecting registry data (called when [[IO_REGISTRY_START]] marker is received)
   * 
   * NEW: Implements "Initial Sync Flush" to ensure any runtime pin definitions (e.g., from updatePinMode)
   * are sent to clients before the registry is cleared. This prevents losing pin definitions that arrive
   * before the IO_REGISTRY_START marker.
   */
  startCollection(): void {
    if (this.destroyed) return;
    // Collection start (not logged individually — too noisy).
    
    // ROBUSTNESS: Flush current registry state before clearing
    // This ensures any pins added via updatePinMode before IO_REGISTRY_START marker are sent
    if (!this.waitingForRegistry && this.registry.length > 0 && this.isDirty) {
      const hasDefinedPins = this.registry.some((p) => p.defined);
      if (hasDefinedPins) {
        this.logger.info(
          `Initial Sync Flush: Sending ${this.registry.length} pins before clearing for new collection`,
        );
        const preCollectionHash = this.computeRegistryHash();
        this.sendNow(preCollectionHash, "pre-collection-flush");
      }
    }
    
    this.isCollecting = true;
    this.registry = [];
    
    // Reset telemetry counters and restart heartbeat
    this.telemetry.incomingEvents = 0;
    this.telemetry.sentBatches = 0;
    this.telemetry.serialOutputEvents = 0;
    this.telemetry.serialOutputBytes = 0;
    this.telemetry.serialOutputBytesTotal = 0;
    this.telemetry.lastReportTime = Date.now();
    
    if (this.onTelemetryCallback && this.enableTelemetry) {
      this.stopTelemetry(); // Clear any previous heartbeat
      this.startHeartbeat();
    }
  }

  /**
   * Detect and annotate conflicts on a single pin record in-place.
   *
   * Checks:
   *   – Multiple distinct pinMode modes in usedAt  → TC11 / multi-mode conflict
   *   – INPUT/INPUT_PULLUP mode + digitalWrite/analogWrite in usedAt  → TC9
   *   – OUTPUT mode combined with digitalRead/analogRead in usedAt  → TC9b
   */
  private detectConflictsForPin(pin: IOPinRecord): void {
    const ops = pin.usedAt ?? [];

    const pinModeOps = ops.filter((u) => u.operation.startsWith("pinMode:"));
    const distinctModes = new Set(pinModeOps.map((u) => u.operation));

    if (distinctModes.size > 1) {
      pin.conflict = true;
      const modeNames = Array.from(distinctModes).map((op) => {
        const n = parseInt(op.split(":")[1], 10);
        return n === 0 ? "INPUT" : n === 1 ? "OUTPUT" : "INPUT_PULLUP";
      });
      pin.conflictMessage = `Multiple modes: ${modeNames.join(", ")}`;
      return;
    }

    // TC9: INPUT/INPUT_PULLUP + digitalWrite/analogWrite
    const hasInput = ops.some(
      (u) => u.operation === "pinMode:0" || u.operation === "pinMode:2",
    );
    const hasWrite = ops.some(
      (u) => u.operation === "digitalWrite" || u.operation === "analogWrite",
    );
    if (hasInput && hasWrite && !pin.conflict) {
      pin.conflict = true;
      const inputModeName = ops.some((u) => u.operation === "pinMode:2")
        ? "INPUT_PULLUP"
        : "INPUT";
      pin.conflictMessage = `Write on ${inputModeName} pin`;
      return;
    }

    // TC9b: OUTPUT + digitalRead/analogRead
    const hasOutput = ops.some((u) => u.operation === "pinMode:1");
    const hasRead = ops.some(
      (u) => u.operation === "digitalRead" || u.operation === "analogRead",
    );
    if (hasOutput && hasRead && !pin.conflict) {
      pin.conflict = true;
      pin.conflictMessage = "Read on OUTPUT pin";
    }
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
    // Individual pin additions are not logged (20 per start is too noisy).
    const existingIndex = this.registry.findIndex((p) => p.pin === pinRecord.pin);
    if (existingIndex >= 0) {
      const existing = this.registry[existingIndex];
      this.registry[existingIndex] = {
        ...existing,
        ...pinRecord,
        defined: existing.defined || pinRecord.defined,
        usedAt: mergeUsedAtEntries(existing.usedAt, pinRecord.usedAt),
      };
    } else {
      this.registry.push(pinRecord);
    }
    this.isDirty = true;
    this.telemetry.incomingEvents++;
  }

  /**
   * Telemetry-only: called when a pin value change is observed outside of the
   * registry collection. These events do not mutate the registry itself.
   */
  updatePinValue(_pin: number, _value: number): void {
    if (this.destroyed) return;
    // count the incoming event for telemetry purposes
    this.telemetry.incomingEvents++;
    // no structural change, so nothing else to do
  }

  /**
   * Telemetry-only counterpart for PWM changes.
   */
  updatePinPWM(_pin: number, _value: number): void {
    if (this.destroyed) return;
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

    // Annotate conflicts now that all pins from the IO_REGISTRY burst are known
    for (const pin of this.registry) {
      this.detectConflictsForPin(pin);
    }

    this.isDirty = true;
    const nextHash = this.computeRegistryHash();
    if (nextHash !== this.registryHash) {
      this.sendNow(nextHash, "collection-complete");
    } else {
      this.isDirty = false;
    }
    this.waitingForRegistry = false;
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  /**
   * Set the baudrate (parsed from Serial.begin() in user code)
   * Only set if baudrate is explicitly defined in the code (not default 9600)
   */
  setBaudrate(baudrate: number): void {
    if (this.destroyed) return;
    if (baudrate > 0) {
      // Only set if non-default (not 9600)
      // This ensures we know that Serial.begin() was actually in the code
      if (baudrate !== 9600) {
        this.logger.debug(`Baudrate from Serial.begin(): ${baudrate}`);
        this.baudrate = baudrate;
      } else {
        // Default 9600 might mean Serial.begin() wasn't in the code
        // Leave as undefined so we don't send a false positive
        this.logger.debug(`Serial.begin(9600) - not sending default bandrate`);
      }
    }
  }

  /**
   * Update a pin's mode at runtime (called when [[PIN_MODE:pin:mode]] is received)
   */
  updatePinMode(pin: number, mode: number): void {
    if (this.destroyed) return;
    // ── Anti-spam: skip if this (pin, mode) was already sent ─────────────────
    const fingerprint = `${pin}:${mode}`;
    if (this.runtimeSentFingerprints.has(fingerprint)) {
      this.telemetry.incomingEvents++;
      return; // No new information – don't update registry or trigger WS send
    }
    const pinStr = pin >= 14 && pin <= 19 ? `A${pin - 14}` : String(pin);
    const existing = this.registry.find((p) => p.pin === pinStr);

    this.logger.debug(
      `updatePinMode: pin=${pin} (${pinStr}), mode=${mode}, existing=${!!existing}, wasDefinedBefore=${existing?.defined || false}`,
    );

    if (existing) {
      const wasDefinedBefore = existing.defined;
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

      // Re-run conflict detection using the shared helper (covers multi-mode
      // AND OUTPUT+digitalRead, consistent with finishCollection).
      const hadConflict = existing.conflict;
      this.detectConflictsForPin(existing);
      const newConflict = existing.conflict && !hadConflict;

      this.telemetry.incomingEvents++;

      // Structural changes (defined: false -> true) must be sent immediately.
      // If the pin was already defined, do not re-send the registry.
      if (!wasDefinedBefore) {
        this.logger.debug(
          `Structural change: pin ${pinStr} marked as defined, sending immediately`,
        );
        this.logger.info(
          `Registry send trigger: first-time pin use ${pinStr} (pinMode:${mode})`,
        );
        this.runtimeSentFingerprints.add(fingerprint);
        this.isDirty = true;
        if (!this.isCollecting && !this.waitingForRegistry) {
          const nextHash = this.computeRegistryHash();
          this.sendNow(nextHash, "pin-defined-changed");
        }
      } else {
        // Already defined but new mode (mode change) – mark as sent.
        // If this mode change introduced a new conflict, send immediately.
        this.runtimeSentFingerprints.add(fingerprint);
        if (newConflict) {
          this.isDirty = true;
          if (!this.isCollecting && !this.waitingForRegistry) {
            const nextHash = this.computeRegistryHash();
            this.sendNow(nextHash, "pin-conflict-detected");
          }
        }
      }
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
      this.logger.debug(
        `New pin record created: ${pinStr} with mode=${mode}, sending immediately`,
      );
      this.runtimeSentFingerprints.add(fingerprint);
      if (!this.isCollecting && !this.waitingForRegistry) {
        const nextHash = this.computeRegistryHash();
        this.sendNow(nextHash, "pin-new-record");
      }
    }
  }



  /**
   * Track a serial output event (called when serial data is sent)
   */
  trackSerialOutput(bytes: number = 0): void {
    if (this.destroyed) return;
    this.telemetry.serialOutputEvents++;
    this.telemetry.serialOutputBytes += bytes;
    this.telemetry.serialOutputBytesTotal += bytes;
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
        if (this.isDirty) {
          const nextHash = this.computeRegistryHash();
          if (nextHash !== this.registryHash) {
            this.sendNow(nextHash, "wait-timeout-flush");
          }
        }
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
    this.runtimeSentFingerprints.clear(); // reset anti-spam state for new sketch run

    this.stopTelemetry();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }

    // Reset complete (not logged — happens on every stop/start cycle).
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
    
    this.stopTelemetry();

    // Close debug stream if open
    if (this.debugStream) {
      this.debugStream.end();
      this.debugStream = null;
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
   * Immediately send the registry via callback
   * Cancels any pending throttle timer to ensure structural changes reach UI immediately
   */
  private sendNow(hash: string, reason?: string): void {
    // Cancel any pending throttle timer to ensure immediate send
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.registryHash = hash;
    this.isDirty = false;
    this.telemetry.sentBatches++;

    if (this.onUpdateCallback) {
      // Enhanced logging: show which pins are being sent, especially pin 13
      const pinsList = this.registry.map((p) => `${p.pin}(def=${p.defined})`).join(",");
      const hasPin13 = this.registry.some((p) => p.pin === "13");
      if (reason && !this.destroyed) {
        const baudInfo = this.baudrate !== undefined ? ` | baud=${this.baudrate}` : " | baud=not-defined";
        this.logger.info(
          `📤 Registry SEND [${reason}]: ${this.registry.length} pins [${pinsList}]${baudInfo} ${hasPin13 ? "✅ PIN13_INCLUDED" : "❌ NO_PIN13"}`,
        );
      }
      // Clean up registry to remove useless line: 0 entries
      const cleanedRegistry = this.registry.map(cleanupPinRecord);
      // Only send baudrate if it was actually defined in the code
      this.onUpdateCallback(cleanedRegistry, this.baudrate, reason);
    }
  }

  private computeRegistryHash(): string {
    const normalized = this.registry.map((pin) => ({
      pin: pin.pin,
      defined: pin.defined,
      pinMode: pin.pinMode,
      usedAt: pin.usedAt ? [...pin.usedAt] : [],
    }));
    normalized.sort((a, b) => a.pin.localeCompare(b.pin));
    return JSON.stringify(normalized);
  }

  /**
   * Legacy hash calculation removed in favor of isDirty flag
   */
}
