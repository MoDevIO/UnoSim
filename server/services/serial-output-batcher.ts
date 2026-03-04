/**
 * Serial Output Batcher
 * 
 * Batches serial output with baudrate-based rate limiting to prevent overwhelming
 * the WebSocket connection and simulate realistic Arduino serial behavior.
 * 
 * Key features:
 * - Ring-Buffer (Uint8Array) for O(1) writes without string allocation overhead
 * - Tick-based batching (default 50ms = 20 batches/sec, like PinStateBatcher)
 * - Baudrate-based byte budget per tick
 * - FIFO drop strategy when buffer full (no unbounded growth)
 * - Burst tolerance for short spikes (e.g., setup() output)
 * - Telemetry tracking (intended/actual/dropped bytes)
 * - Newline-aware cutting (prefer line boundaries)
 */

import { RingBuffer } from "@shared/utils/ring-buffer";

export interface SerialOutputBatcherConfig {
  /** Baudrate in bits per second (e.g., 115200) */
  baudrate: number;
  /** Tick interval in milliseconds (default: 50ms = 20 batches/sec) */
  tickIntervalMs?: number;
  /** Callback invoked with each batch. firstLineIncomplete=true if this chunk starts with a truncated line (due to drops). */
  onChunk: (data: string, firstLineIncomplete?: boolean) => void;
  /** Burst factor (default: 3 = 3× normal budget for short spikes) */
  burstFactor?: number;
}

export interface SerialOutputTelemetry {
  /** Total bytes intended to send since last reset */
  intended: number;
  /** Total bytes actually sent since last reset */
  actual: number;
  /** Total bytes dropped since last reset */
  dropped: number;
  /** Number of chunks sent since last reset */
  chunks: number;
  /** Cumulative bytes intended since batcher start (never resets) */
  totalBytes: number;
}

export class SerialOutputBatcher {
  private config: Required<SerialOutputBatcherConfig>;
  private pendingBuffer: RingBuffer; // Ring-Buffer instead of string accumulation
  private tickTimer: NodeJS.Timeout | null = null;
  
  // paused flag prevents enqueue/start while paused (tests rely on this)
  private paused = false;
  
  // Telemetry counters (reset periodically)
  private intendedBytes = 0;
  private actualBytes = 0;
  private droppedBytes = 0;
  private chunks = 0;
  
  // Total bytes counter (never reset, accumulates over lifetime)
  private totalBytes = 0;
  
  // Burst budget tracking
  private currentBudget = 0;
  private maxBudget = 0;
  
  // Fractional byte accumulator for low baudrates
  // At baud=1: normalBudget per tick = 0.005 bytes, which rounds to 0.
  // The accumulator carries over the fractional part so that after 200 ticks
  // (10 seconds), 1 byte gets through — correctly simulating 0.1 bytes/s.
  private budgetAccumulator = 0;
  
  // Maximum queue size before applying FIFO drops (for memory safety)
  // This prevents unbounded buffering in pathological cases (e.g., data arriving
  // much faster than baudrate allows). Typical value: 100KB.
  private readonly MAX_QUEUE_BYTES = 100_000;

  // Backpressure threshold (upper watermark in bytes). When the buffered
  // data rises above this, the runner will pause the sketch.  We'll add
  // a lower 'resume' watermark inside isOverloaded() to prevent thrashing.
  // Start with 512 bytes to give some headroom for slow baud rates.
  private readonly BACKPRESSURE_THRESHOLD = 512;

  // internal flag used by hysteresis logic
  private overloadedState = false;
  
  // Flag to prevent enqueue after destroy
  private destroyed = false;
  
  constructor(config: SerialOutputBatcherConfig) {
    this.config = {
      baudrate: config.baudrate,
      tickIntervalMs: config.tickIntervalMs ?? 50,
      onChunk: config.onChunk,
      burstFactor: config.burstFactor ?? 3,
    };
    
    // Initialize ring buffer with capacity equal to MAX_QUEUE_BYTES
    // This prevents unbounded memory growth while allowing burst handling
    this.pendingBuffer = new RingBuffer(this.MAX_QUEUE_BYTES);
    
    this.updateBudget();
  }
  
  /**
   * Calculate and update byte budget based on baudrate
   */
  private updateBudget(): void {
    // Byte budget per tick = (baudrate / 10 bits per byte) × (tick interval in seconds)
    const bytesPerSecond = this.config.baudrate / 10;
    const bytesPerTick = bytesPerSecond * (this.config.tickIntervalMs / 1000);
    const burstBudget = bytesPerTick * this.config.burstFactor;
    
    // maxBudget: determines initial burst capacity and max accumulation.
    // For high bauds (≥ ~3333): burstBudget (3 × bytesPerTick) dominates naturally.
    // For low bauds (< 3333): a proportional floor ensures typical println() works.
    //   - The floor = min(50, ceil(bytesPerSecond × 0.5)) = "half a second of output, max 50"
    //   - At 300 baud: floor = min(50, 15) = 15 → covers "Hello World!\n" (14 bytes)
    //   - At 1200 baud: floor = min(50, 60) = 50 → same as old MIN_BUDGET
    //   - At baud=1: floor = min(50, 1) = 1 → nearly nothing (correct for 0.1 bytes/s)
    // The old hardcoded MIN_BUDGET=50 gave baud=1 a 50-byte free pass, defeating rate limiting.
    // This proportional approach fixes that while preserving setup() burst for standard bauds.
    const proportionalFloor = Math.min(50, Math.ceil(bytesPerSecond * 0.5));
    this.maxBudget = Math.max(1, Math.floor(burstBudget), proportionalFloor);
    this.currentBudget = this.maxBudget; // Start with full burst budget
    this.budgetAccumulator = 0;
  }
  
  /**
   * Enqueue data for batching
   * 
   * If queue size would exceed MAX_QUEUE_BYTES (memory safety limit),
   * drop oldest bytes using FIFO strategy (not "tail wins").
   * 
   * NOTE: We count ALL enqueued data as "intended" - even if it will later be dropped.
   * The telemetry semantic is: actual + dropped = intended
   */
  enqueue(data: string): void {
    // After destroy(), enqueue is a no-op
    if (this.destroyed) return;

    // Count as intended (part of telemetry accounting)
    this.intendedBytes += data.length;
    this.totalBytes += data.length;

    // Write to ring buffer - it handles overflow internally via FIFO
    const bytesWritten = this.pendingBuffer.write(data);
    
    // Track any bytes that couldn't fit (dropped due to ring buffer capacity)
    if (bytesWritten < data.length) {
      const bytesDropped = data.length - bytesWritten;
      this.droppedBytes += bytesDropped;
    }

    // Ensure the ticking timer is running; do not create multiple intervals.
    // However, if we're paused we must not start or restart the timer – data
    // should remain buffered until resume().
    if (!this.tickTimer && !this.paused) {
      this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);
    }
  }
  
  /**
   * Stop the timer and flush remaining data (without limit)
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    
    // Flush all remaining data without budget limit
    const remaining = this.pendingBuffer.readAll();
    if (remaining.length > 0) {
      this.config.onChunk(remaining);
      this.actualBytes += remaining.length;
      this.chunks++;
    }
  }
  
  /**
   * Pause the timer (keeps pending data)
   */
  pause(): void {
    this.paused = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
  
  /**
   * Resume the timer
   */
  resume(): void {
    this.paused = false;
    this.start();
  }
  
  /**
   * Destroy the batcher (stop timer, discard data, no callbacks)
   */
  destroy(): void {
    this.destroyed = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.pendingBuffer.clear();
  }
  
  /**
   * Start the batching timer.
   *
   * The timer is not automatically started in the constructor because the
   * caller may choose to configure additional callbacks first (e.g. the
   * runner sets output/error handlers after instantiation).  The public
   * `start()` method mirrors the semantics described in the design docs and
   * allows the timer to be restarted after `pause()`.
   */
  start(): void {
    // don't start when paused or already running
    if (this.tickTimer || this.paused) return;
    this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  /**
   * Return true when the current buffer has grown past the overload threshold.
   * Used by SandboxRunner to implement backpressure. Simple getter keeps the
   * knowledge encapsulated and allows the threshold to change easily.
   */
  isOverloaded(): boolean {
    // Special-case: when the baudrate is so low that the C++ side applies its
    // txDelay cap (e.g. 300 baud → 10 ms max delay), we intentionally disable
    // backpressure.  Injecting 50 ms SIGSTOP pauses would defeat the cap and
    // slow sketches instead of helping them.
    if (this.config.baudrate <= 300) {
      return false;
    }

    // Scale threshold for low-but-not-tiny bauds.  The original hardcoded
    // BACKPRESSURE_THRESHOLD=512 bytes is fine for high-speed sketches, but a
    // 1200‑baud sketch can easily accumulate several hundred bytes while the
    // mock's txDelay cap is in effect.  Raising the limit to 1024 gives more
    // headroom and avoids premature SIGSTOP storms.
    const threshold = this.config.baudrate < 4800 ? 1024 : this.BACKPRESSURE_THRESHOLD;

    // Hysteresis: once we've declared overloaded we stay in that state until
    // the buffer falls below a low-watermark.  We keep the watermark at 128
    // bytes (≈1/4 of the original threshold) so throttling behaviour remains
    // snappy without toggling around the boundary.
    const lowWatermark = 128;
    const bufferSize = this.pendingBuffer.getSize();

    if (this.overloadedState) {
      if (bufferSize < lowWatermark) {
        this.overloadedState = false;
      }
    } else {
      if (bufferSize > threshold) {
        this.overloadedState = true;
      }
    }
    return this.overloadedState;
  }

  /**
   * Change baudrate and recalculate budget
   */
  setBaudrate(baudrate: number): void {
    this.config.baudrate = baudrate;
    this.updateBudget();
  }
  
  /**
   * Get telemetry and reset counters (except totalBytes)
   */
  getTelemetryAndReset(): SerialOutputTelemetry {
    const telemetry: SerialOutputTelemetry = {
      intended: this.intendedBytes,
      actual: this.actualBytes,
      dropped: this.droppedBytes,
      chunks: this.chunks,
      totalBytes: this.totalBytes,
    };
    
    // Reset periodic counters
    this.intendedBytes = 0;
    this.actualBytes = 0;
    this.droppedBytes = 0;
    this.chunks = 0;
    
    return telemetry;
  }
  
  /**
   * Tick handler: process pending data with budget limit
   * 
   * STRATEGY: No data is dropped. Instead, data is buffered and will be sent
   * as the baudrate allows. This is correct for serial data where FIFO order matters
   * and completeness is more important than timing.
   * 
   * If bandwidth is insufficient for the data rate, output will be delayed but complete.
   * Uses RingBuffer for O(1) operations without string allocation overhead.
   */
  private tick(): void {
    // Token bucket replenishment with fractional byte accumulation.
    // At low baudrates, bytesPerTick < 1 (e.g., baud=1 → 0.005 bytes/tick).
    // We accumulate the fractional part and only grant whole bytes.
    const bytesPerSecond = this.config.baudrate / 10;
    const rawBytesPerTick = bytesPerSecond * (this.config.tickIntervalMs / 1000);
    this.budgetAccumulator += rawBytesPerTick;
    const wholeBytesToAdd = Math.floor(this.budgetAccumulator);
    this.budgetAccumulator -= wholeBytesToAdd;
    this.currentBudget = Math.min(
      this.currentBudget + wholeBytesToAdd,
      this.maxBudget
    );
    
    if (this.pendingBuffer.isEmpty()) {
      return;
    }
    
    // Use current accumulated budget (can be up to maxBudget for bursts)
    const budget = this.currentBudget;
    const bufferSize = this.pendingBuffer.getSize();
    
    if (bufferSize <= budget) {
      // All data fits in budget - extract and send everything
      const dataToSend = this.pendingBuffer.readAll();
      if (dataToSend.length > 0) {
        this.config.onChunk(dataToSend, false); // no truncation
        this.actualBytes += dataToSend.length;
        this.chunks++;
        this.currentBudget -= dataToSend.length;
      }
    } else {
      // Data exceeds budget: send what fits, keep rest in buffer for next tick
      // Read up to budget bytes
      let dataToSend = this.pendingBuffer.read(budget);
      
      // Try to cut at newline boundary to avoid sending truncated lines
      const lastNewlineIndex = dataToSend.lastIndexOf("\n");
      if (lastNewlineIndex !== -1 && lastNewlineIndex < dataToSend.length - 1) {
        // There's a newline within what we read (not at very end)
        // Keep everything up to and including that newline, put back the rest
        const toRequeue = dataToSend.slice(lastNewlineIndex + 1);
        dataToSend = dataToSend.slice(0, lastNewlineIndex + 1);
        // Re-enqueue the bytes we're not using yet
        this.pendingBuffer.write(toRequeue);
      }
      
      if (dataToSend.length > 0) {
        this.config.onChunk(dataToSend, false); // data is complete, not truncated
        this.actualBytes += dataToSend.length;
        this.chunks++;
      }
      
      // Deduct what we sent from budget
      this.currentBudget = Math.max(0, this.currentBudget - dataToSend.length);
    }
  }
}
