/**
 * Ring Buffer (Circular Buffer)
 * 
 * High-performance binary buffer for efficient serial output batching.
 * Eliminates string accumulation overhead and prevents O(n²) garbage collection pressure.
 * 
 * Features:
 * - Fixed-size Uint8Array allocation (no dynamic reallocation)
 * - Write pointer advances without shifting data (circular semantics)
 * - Fast write/read without string copies
 * - Efficient extraction to string (single decoder pass)
 * - Memory-bounded (no unbounded growth)
 */

export class RingBuffer {
  private buffer: Uint8Array;
  private writePos = 0;
  private readPos = 0;
  private size = 0; // Current number of bytes in buffer

  /**
   * Create a ring buffer with fixed capacity
   * @param capacity Maximum bytes to hold (e.g., 8192 for typical serial batching)
   */
  constructor(capacity: number = 8192) {
    this.buffer = new Uint8Array(capacity);
  }

  /**
   * Get current number of bytes in buffer
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get buffer capacity
   */
  getCapacity(): number {
    return this.buffer.length;
  }

  /**
   * Write string data to buffer as UTF-8 bytes
   * If buffer would overflow, returns number of bytes actually written (may be less than input)
   * @returns bytes written
   */
  write(data: string): number {
    if (!data.length) return 0;

    // Encode string to UTF-8 bytes
    const encoded = new TextEncoder().encode(data);
    const availableSpace = this.buffer.length - this.size;

    // Truncate if overflow
    const bytesToWrite = Math.min(encoded.length, availableSpace);

    if (bytesToWrite === 0) return 0;

    // Write to circular buffer without modifying readPos
    for (let i = 0; i < bytesToWrite; i++) {
      this.buffer[(this.writePos + i) % this.buffer.length] = encoded[i];
    }

    this.writePos = (this.writePos + bytesToWrite) % this.buffer.length;
    this.size += bytesToWrite;

    return bytesToWrite;
  }

  /**
   * Read and extract all buffered data as string, clearing the buffer
   * @returns extracted string
   */
  readAll(): string {
    if (this.size === 0) return '';

    // Extract bytes in order (handling wrap-around)
    const result = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(this.readPos + i) % this.buffer.length];
    }

    // Decode to string once
    const str = new TextDecoder().decode(result);

    // Clear buffer
    this.readPos = this.writePos;
    this.size = 0;

    return str;
  }

  /**
   * Read up to maxBytes and extract as string, clearing those bytes from buffer
   * @returns extracted string
   */
  read(maxBytes: number): string {
    if (this.size === 0 || maxBytes <= 0) return '';

    const bytesToRead = Math.min(maxBytes, this.size);
    const result = new Uint8Array(bytesToRead);

    for (let i = 0; i < bytesToRead; i++) {
      result[i] = this.buffer[(this.readPos + i) % this.buffer.length];
    }

    const str = new TextDecoder().decode(result);

    this.readPos = (this.readPos + bytesToRead) % this.buffer.length;
    this.size -= bytesToRead;

    return str;
  }

  /**
   * Peek at buffered data without clearing it
   * @returns string view of all buffered data
   */
  peek(): string {
    if (this.size === 0) return '';

    const result = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(this.readPos + i) % this.buffer.length];
    }

    return new TextDecoder().decode(result);
  }

  /**
   * Clear all buffered data
   */
  clear(): void {
    this.readPos = this.writePos;
    this.size = 0;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Check if buffer is at capacity
   */
  isFull(): boolean {
    return this.size === this.buffer.length;
  }

  /**
   * Get available space for writing
   */
  getAvailableSpace(): number {
    return this.buffer.length - this.size;
  }
}
