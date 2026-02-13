/**
 * Serial Output Batcher
 * 
 * Batches serial output with baudrate-based rate limiting to prevent overwhelming
 * the WebSocket connection and simulate realistic Arduino serial behavior.
 * 
 * Key features:
 * - Tick-based batching (default 50ms = 20 batches/sec, like PinStateBatcher)
 * - Baudrate-based byte budget per tick
 * - "Tail wins" drop strategy (newest data is kept when budget exceeded)
 * - Burst tolerance for short spikes (e.g., setup() output)
 * - Telemetry tracking (intended/actual/dropped bytes)
 * - Newline-aware cutting (prefer line boundaries)
 */

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
  private pendingData = "";
  private tickTimer: NodeJS.Timeout | null = null;
  
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
  
  constructor(config: SerialOutputBatcherConfig) {
    this.config = {
      baudrate: config.baudrate,
      tickIntervalMs: config.tickIntervalMs ?? 50,
      onChunk: config.onChunk,
      burstFactor: config.burstFactor ?? 3,
    };
    
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
   */
  enqueue(data: string): void {
    this.pendingData += data;
    // Note: intendedBytes is counted in tick() when data is actually processed (sent or dropped)
    this.totalBytes += data.length;
  }
  
  /**
   * Start the tick timer
   */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);
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
    if (this.pendingData.length > 0) {
      this.config.onChunk(this.pendingData);
      this.actualBytes += this.pendingData.length;
      this.chunks++;
      this.pendingData = "";
    }
  }
  
  /**
   * Pause the timer (keeps pending data)
   */
  pause(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
  
  /**
   * Resume the timer
   */
  resume(): void {
    this.start();
  }
  
  /**
   * Destroy the batcher (stop timer, discard data, no callbacks)
   */
  destroy(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.pendingData = "";
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
    
    if (this.pendingData.length === 0) {
      return;
    }
    
    // Use current accumulated budget (can be up to maxBudget for bursts)
    const budget = this.currentBudget;
    
    if (this.pendingData.length <= budget) {
      // All data fits in budget
      const bytesToSend = this.pendingData.length;
      this.config.onChunk(this.pendingData, false); // no truncation
      this.actualBytes += bytesToSend;
      this.intendedBytes += bytesToSend;  // Count intended bytes when actually sent
      this.currentBudget -= bytesToSend;
      this.pendingData = "";
      this.chunks++;
    } else {
      // Data exceeds budget: drop oldest, keep newest (tail wins)
      const totalInBuffer = this.pendingData.length;
      let dropped = totalInBuffer - budget;
      this.intendedBytes += totalInBuffer;  // Count all data that was "intended" (both dropped and sent)
      this.droppedBytes += dropped;
      
      // Extract the newest data (tail) - skip the oldest bytes
      let dataToSend = this.pendingData.slice(dropped);
      
      // Always cut at first newline boundary to avoid sending truncated line fragments.
      // After dropping, the first part of dataToSend is likely a partial line (the tail
      // of a line whose beginning was dropped). Skip to after the first \n if there is
      // still content remaining — this ensures only complete lines are sent, preventing
      // isComplete:true on truncated data. If the \n is the very last char, the entire
      // buffer is one (truncated) line and skipping would discard everything, so keep it.
      const firstNewlineIndex = dataToSend.indexOf("\n");
      if (firstNewlineIndex !== -1 && firstNewlineIndex < dataToSend.length - 1) {
        const skipped = firstNewlineIndex + 1;
        dataToSend = dataToSend.slice(skipped);
        dropped += skipped;
        this.droppedBytes += skipped;
      }
      
      // Send surviving data (drops are visible via telemetry)
      // Signal that first line is truncated if we dropped data and didn't skip to newline
      const firstLineIncomplete = dropped > 0 && dataToSend.length > 0;
      if (dataToSend.length > 0) {
        this.config.onChunk(dataToSend, firstLineIncomplete);
        this.actualBytes += dataToSend.length;
        this.chunks++;
      }
      this.currentBudget = Math.max(0, this.currentBudget - budget);
      this.pendingData = "";
    }
  }
}
