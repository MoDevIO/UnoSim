import { EventEmitter } from 'events';

export type PrintModifier = 'BIN' | 'OCT' | 'HEX' | number;

export class ArduinoOutputParser extends EventEmitter {
  private buffer: string = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushDelay: number = 20;

  constructor() {
    super();
  }

  /**
   * Emulates Arduino's Serial.print() behavior
   * @param value - The value to print (number, string, boolean)
   * @param modifier - Optional: BIN, OCT, HEX for integers, or precision for floats
   */
  print(value: number | string | boolean, modifier?: PrintModifier): void {
    let output: string;

    if (typeof value === 'boolean') {
      // Boolean: convert to "1" or "0"
      output = value ? '1' : '0';
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        // Integer handling
        if (modifier === 'BIN') {
          output = value.toString(2);
        } else if (modifier === 'OCT') {
          output = value.toString(8);
        } else if (modifier === 'HEX') {
          output = value.toString(16).toUpperCase();
        } else {
          output = value.toString(10);
        }
      } else {
        // Float handling
        const precision = typeof modifier === 'number' ? modifier : 2;
        output = value.toFixed(precision);
      }
    } else {
      // String: pass through
      output = String(value);
    }

    this.append(output);
  }

  /**
   * Emulates Arduino's Serial.println()
   */
  println(value: number | string | boolean = '', modifier?: PrintModifier): void {
    this.print(value, modifier);
    this.append('\n');
  }

  /**
   * Appends data to the buffer and manages flush timing
   */
  private append(data: string): void {
    this.buffer += data;

    // Clear existing timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Immediate flush on newline or carriage return
    if (data.includes('\n') || data.includes('\r')) {
      this.flush();
    } else {
      // Schedule timed flush
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, this.flushDelay);
    }
  }

  /**
   * Flushes the buffer and emits 'data' event
   */
  private flush(): void {
    if (this.buffer.length > 0) {
      this.emit('data', this.buffer);
      this.buffer = '';
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Resets the parser state
   */
  reset(): void {
    this.buffer = '';
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Returns current buffer content (for testing)
   */
  getBuffer(): string {
    return this.buffer;
  }
}
