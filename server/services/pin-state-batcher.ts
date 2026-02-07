/**
 * Pin State Batching Layer
 * 
 * Batches high-frequency pin state changes into lower-frequency batches
 * to reduce WebSocket message overhead (2000 msg/sec → 20 msg/sec).
 * 
 * Key Features:
 * - Tick-based batching (default 50ms = 20 batches/sec)
 * - "Last value wins" deduplication per pin:stateType
 * - Telemetry tracking (intended vs actual pin changes)
 * - Pause/Resume support
 * - Flush on stop
 */

export interface PinStateEvent {
  pin: number;
  stateType: "mode" | "value" | "pwm";
  value: number;
}

export interface PinStateBatch {
  states: PinStateEvent[];
  timestamp: number;
}

export interface PinStateBatcherConfig {
  /** Tick interval in milliseconds (default: 50ms = 20 batches/sec) */
  tickIntervalMs?: number;
  /** Callback invoked with each batch */
  onBatch: (batch: PinStateBatch) => void;
}

export class PinStateBatcher {
  private config: Required<PinStateBatcherConfig>;
  private pendingStates = new Map<string, PinStateEvent>();
  private tickTimer: NodeJS.Timeout | null = null;
  private intendedCount = 0;
  private actualCount = 0;

  constructor(config: PinStateBatcherConfig) {
    this.config = {
      tickIntervalMs: config.tickIntervalMs ?? 50,
      onBatch: config.onBatch,
    };
  }

  /**
   * Enqueue a pin state change.
   * Called for every pin change from the simulator (~2000/sec).
   */
  enqueue(pin: number, stateType: "mode" | "value" | "pwm", value: number): void {
    const key = `${pin}:${stateType}`;
    this.pendingStates.set(key, { pin, stateType, value });
    this.intendedCount++;
  }

  /**
   * Start the tick timer to begin batching.
   */
  start(): void {
    if (this.tickTimer) {
      return; // Already started
    }
    this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  /**
   * Stop the tick timer and flush any remaining pending states.
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    // Flush remaining states
    this.flush();
  }

  /**
   * Pause ticking (keep pending states, stop timer).
   */
  pause(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    // Do NOT flush - keep pending states
  }

  /**
   * Resume ticking after pause.
   */
  resume(): void {
    this.start();
  }

  /**
   * Get telemetry counters and reset them.
   */
  getTelemetryAndReset(): { intended: number; actual: number } {
    const result = {
      intended: this.intendedCount,
      actual: this.actualCount,
    };
    this.intendedCount = 0;
    this.actualCount = 0;
    return result;
  }

  /**
   * Destroy the batcher, stop timer, discard pending states.
   */
  destroy(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.pendingStates.clear();
  }

  /**
   * Tick handler: send batch if there are pending states.
   */
  private tick(): void {
    this.flush();
  }

  /**
   * Flush pending states as a batch.
   */
  private flush(): void {
    if (this.pendingStates.size === 0) {
      return;
    }

    const states = Array.from(this.pendingStates.values());
    this.pendingStates.clear();
    this.actualCount += states.length;

    this.config.onBatch({
      states,
      timestamp: Date.now(),
    });
  }
}
