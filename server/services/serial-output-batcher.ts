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
  /** Callback invoked with each batch */
  onChunk: (data: string) => void;
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
    this.maxBudget = Math.floor(bytesPerTick * this.config.burstFactor);
    this.currentBudget = this.maxBudget; // Start with full burst budget
  }
  
  /**
   * Enqueue data for batching
   */
  enqueue(data: string): void {
    this.pendingData += data;
    this.intendedBytes += data.length;
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
    if (this.pendingData.length === 0) {
      // Refill budget if idle (up to max)
      const bytesPerSecond = this.config.baudrate / 10;
      const normalBudget = Math.floor(bytesPerSecond * (this.config.tickIntervalMs / 1000));
      this.currentBudget = Math.min(
        this.currentBudget + normalBudget,
        this.maxBudget
      );
      return;
    }
    
    // Use current accumulated budget (can be up to maxBudget for bursts)
    const budget = this.currentBudget;
    
    if (this.pendingData.length <= budget) {
      // All data fits in budget
      this.config.onChunk(this.pendingData);
      this.actualBytes += this.pendingData.length;
      this.currentBudget -= this.pendingData.length;
      this.pendingData = "";
      this.chunks++;
    } else {
      // Data exceeds budget: drop oldest, keep newest (tail wins)
      let dropped = this.pendingData.length - budget;
      this.droppedBytes += dropped;
      
      // Extract the newest data (tail) - skip the oldest bytes
      let dataToSend = this.pendingData.slice(dropped);
      
      // Try to cut at newline boundary to avoid partial lines
      // Look for first newline in the data we're keeping
      const firstNewlineIndex = dataToSend.indexOf("\n");
      if (firstNewlineIndex !== -1 && firstNewlineIndex < budget * 0.5) {
        // Found a newline in the first half, skip to after it
        const skipped = firstNewlineIndex + 1;
        dataToSend = dataToSend.slice(skipped);
        dropped += skipped;
        this.droppedBytes += skipped;
      }
      
      // Prepend drop indicator
      const dropIndicator = `[⚠ ${dropped} Bytes verworfen (Baudrate-Limit)]\n`;
      const output = dropIndicator + dataToSend;
      
      this.config.onChunk(output);
      this.actualBytes += dataToSend.length; // Don't count drop indicator in actual
      this.currentBudget = Math.max(0, this.currentBudget - budget);
      this.pendingData = "";
      this.chunks++;
    }
  }
}
