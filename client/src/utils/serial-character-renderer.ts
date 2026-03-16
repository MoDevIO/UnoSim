/**
 * SerialCharacterRenderer
 * 
 * Rendert eingehende Serial-Daten mit baudrate-basierter Verzögerung,
 * um das reale Verhalten eines Arduino Serial Monitors zu simulieren.
 * 
 * Features:
 * - Queue-basiertes Character-Streaming
 * - requestAnimationFrame für smooth Rendering
 * - Baudrate → ms/char Berechnung
 * - Pause/Resume/Clear API
 * - Performance-optimiert für hohe Baudraten
 */

export class SerialCharacterRenderer {
  private queue: string = "";
  private paused: boolean = false;
  private baudrate: number | undefined;
  private lastCharTime: number = 0;
  private rafId: number | null = null;
  private readonly onChar: (char: string) => void;
  private static readonly MAX_QUEUE_SIZE = 50000; // ~50KB safety limit

  constructor(onChar: (char: string) => void) {
    this.onChar = onChar;
  }

  /**
   * Enqueue data for character-by-character rendering
   */
  enqueue(data: string): void {
    // Append new data to queue
    this.queue += data;
    
    // Enforce memory limit: Keep only last MAX_QUEUE_SIZE chars
    if (this.queue.length > SerialCharacterRenderer.MAX_QUEUE_SIZE) {
      const excess = this.queue.length - SerialCharacterRenderer.MAX_QUEUE_SIZE;
      this.queue = this.queue.slice(excess); // Drop oldest chars
    }
    
    // Start rendering if not already running and not paused
    if (!this.rafId && !this.paused && this.queue.length > 0) {
      this.start();
    }
  }

  /**
   * Set baudrate (affects rendering speed)
   */
  setBaudrate(baud: number | undefined): void {
    this.baudrate = baud;
  }

  /**
   * Pause character rendering
   */
  pause(): void {
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Resume character rendering
   */
  resume(): void {
    this.paused = false;
    if (this.queue.length > 0 && this.rafId === null) {
      this.start();
    }
  }

  /**
   * Clear queue and stop rendering
   */
  clear(): void {
    this.queue = "";
    this.pause();
  }

  /**
   * Get current queue length (for debugging/UI feedback)
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if renderer is currently active
   */
  isActive(): boolean {
    return this.rafId !== null;
  }

  /**
   * Destroy renderer and cleanup
   */
  destroy(): void {
    this.clear();
  }

  private start(): void {
    if (this.rafId !== null) return;
    this.lastCharTime = performance.now();
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    // Stop if paused or queue empty
    if (this.paused || this.queue.length === 0) {
      this.rafId = null;
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastCharTime;
    const msPerChar = this.calculateMsPerChar();

    // Check if enough time has passed to render next character(s)
    if (elapsed >= msPerChar) {
      if (msPerChar === 0 || msPerChar < 1) {
        // High baudrate or no baudrate: Batch render
        const charsToRender = msPerChar === 0 
          ? this.queue.length  // No baudrate: render all immediately
          : Math.min(Math.floor(elapsed / msPerChar), this.queue.length);
        
        const batch = this.queue.slice(0, charsToRender);
        this.queue = this.queue.slice(charsToRender);
        
        if (batch.length > 0) {
          this.onChar(batch);
        }
      } else {
        // Low baudrate: Render 1 character at a time
        const char = this.queue[0];
        this.queue = this.queue.slice(1);
        this.onChar(char);
      }
      
      this.lastCharTime = now;
    }

    // Continue if queue has more data
    if (this.queue.length > 0) {
      this.rafId = requestAnimationFrame(() => this.tick());
    } else {
      this.rafId = null;
    }
  }

  private calculateMsPerChar(): number {
    if (!this.baudrate) {
      return 0; // Immediate rendering when baudrate not set
    }

    // Baud = bits/second
    // Serial frame: 1 start bit + 8 data bits + 1 stop bit = 10 bits per byte
    const bytesPerSecond = this.baudrate / 10;
    const secondsPerByte = 1 / bytesPerSecond;
    const msPerByte = secondsPerByte * 1000;

    // Minimum 0.1ms to avoid excessive RAF calls at very high bauds
    return Math.max(0.1, msPerByte);
  }
}
