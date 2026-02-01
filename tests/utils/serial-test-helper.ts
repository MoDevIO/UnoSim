/**
 * Serial Test Helper Utilities
 * 
 * Provides robust utilities for testing Arduino serial output in integration tests.
 * These helpers handle the asynchronous nature of sketch compilation, execution,
 * and output processing with proper timeout handling and error reporting.
 */

import { SandboxRunner } from '../../server/services/sandbox-runner';

/**
 * Extract plain text from serial outputs.
 * 
 * Handles both plain text output and structured SERIAL_EVENT_JSON format.
 * The SandboxRunner may send serial data as JSON events for precise timing
 * and metadata preservation.
 * 
 * @param outputs - Array of output lines or single output string
 * @returns Plain text content with JSON events decoded
 * 
 * @example
 * ```ts
 * const outputs = ['[[SERIAL_EVENT_JSON:{"type":"serial","data":"Hello"}]]'];
 * const text = extractPlainText(outputs); // Returns: "Hello"
 * ```
 */
export function extractPlainText(outputs: string[] | string): string {
  const lines = Array.isArray(outputs) ? outputs : [outputs];
  
  return lines.map(line => {
    // Check if it's a SERIAL_EVENT_JSON formatted output
    const match = line.match(/\[\[SERIAL_EVENT_JSON:(.+?)\]\]/g);
    if (match) {
      // Extract and parse all JSON events in this line
      return match.map(m => {
        try {
          const jsonStr = m.replace('[[SERIAL_EVENT_JSON:', '').replace(']]', '');
          const event = JSON.parse(jsonStr);
          return event.data || '';
        } catch {
          // Malformed JSON - return empty string
          return '';
        }
      }).join('');
    }
    // Plain text output - return as-is
    return line;
  }).join('');
}

/**
 * Wait for SandboxRunner to reach RUNNING state.
 * 
 * WHY THIS IS NECESSARY:
 * - Docker container startup has latency (image pull, container init)
 * - Local compilation can take 1-3 seconds for g++ to process Arduino code
 * - Registry manager has 1.5s wait mode before sending initial pin state
 * 
 * Polling ensures we don't start checking for output before the sketch
 * has even started executing.
 * 
 * @param runner - SandboxRunner instance to monitor
 * @param timeout - Maximum time to wait in milliseconds (default: 15000ms)
 * @throws Error if runner doesn't reach RUNNING state within timeout
 */
export async function waitForRunning(runner: SandboxRunner, timeout = 15000): Promise<void> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (runner.simulationState === 'running') {
      return;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  
  throw new Error(
    `Timeout waiting for runner to reach RUNNING state after ${timeout}ms. ` +
    `Current state: ${runner.simulationState}`
  );
}

/**
 * Wait for specific serial output to appear.
 * 
 * CRITICAL DESIGN NOTES:
 * 1. WHY POLLING: Serial output arrives asynchronously via callbacks. We can't
 *    use Promises directly because multiple output chunks may arrive over time.
 * 
 * 2. WHY GENEROUS TIMEOUT: Docker scenarios need time for:
 *    - Container startup: ~1-2s
 *    - Compilation: ~2-5s (can be 10s+ in CI)
 *    - Execution: varies by sketch
 *    - Serial batching: 20ms buffering for efficiency
 * 
 * 3. WHY CONTENT-BASED: The SerialParser uses 20ms batching, so we can't
 *    predict chunk counts. We only check if the expected content exists.
 * 
 * @param outputs - Reference to array that will be populated by onOutput callback
 * @param target - String to search for in the output
 * @param timeout - Maximum time to wait in milliseconds (default: 30000ms)
 * @param debug - Enable debug logging for long waits (default: true)
 * @throws Error if target string doesn't appear within timeout
 * 
 * @example
 * ```ts
 * const outputs: string[] = [];
 * runner.runSketch(sketch, (line) => outputs.push(line), ...);
 * await waitForSerialOutput(outputs, 'Hello', 10000);
 * expect(extractPlainText(outputs)).toContain('Hello');
 * ```
 */
export async function waitForSerialOutput(
  outputs: string[],
  target: string,
  timeout = 30000,
  debug = true
): Promise<void> {
  const start = Date.now();
  let lastLog = start;
  
  while (Date.now() - start < timeout) {
    const currentOutput = extractPlainText(outputs);
    
    if (currentOutput.includes(target)) {
      return;
    }
    
    // Debug logging if taking longer than 5s
    if (debug) {
      const elapsed = Date.now() - start;
      if (elapsed > 5000 && Date.now() - lastLog > 2000) {
        const preview = currentOutput.substring(0, 100);
        console.log(
          `[waitForSerialOutput] Still waiting for "${target}" after ${(elapsed / 1000).toFixed(1)}s. ` +
          `Current buffer (${currentOutput.length} chars): "${preview}${currentOutput.length > 100 ? '...' : ''}"`
        );
        lastLog = Date.now();
      }
    }
    
    await new Promise(r => setTimeout(r, 50));
  }
  
  throw new Error(
    `Timeout waiting for serial output: "${target}" after ${timeout}ms. ` +
    `Current output: "${extractPlainText(outputs)}"`
  );
}

/**
 * Run an Arduino sketch and wait for it to complete.
 * 
 * CRITICAL: This helper ensures the message queue is properly flushed.
 * 
 * WHY MESSAGE QUEUE FLUSH IS CRITICAL:
 * The SandboxRunner queues output and pin state messages while waiting for
 * the I/O registry to be collected (1.5s wait mode). If a sketch executes
 * and exits quickly (< 1.5s), queued messages were historically lost.
 * 
 * The fix (added to SandboxRunner.ts close handler) calls flushMessageQueue()
 * before process exit, ensuring all queued messages are delivered even for
 * fast-completing sketches.
 * 
 * @param runner - SandboxRunner instance
 * @param sketch - Arduino sketch code to execute
 * @param options - Configuration options
 * @returns Promise resolving to collected outputs and success status
 * 
 * @example
 * ```ts
 * const result = await runSketchWithOutput(runner, 'void setup() { Serial.println("Hi"); }');
 * expect(result.success).toBe(true);
 * expect(extractPlainText(result.outputs)).toContain('Hi');
 * ```
 */
export async function runSketchWithOutput(
  runner: SandboxRunner,
  sketch: string,
  options: {
    timeout?: number;
    fallbackTimeout?: number;
  } = {}
): Promise<{
  outputs: string[];
  success: boolean;
  error?: string;
}> {
  const outputs: string[] = [];
  const timeout = options.timeout ?? 15;
  const fallbackTimeout = options.fallbackTimeout ?? 25000;
  
  const result = await new Promise<{ outputs: string[]; success: boolean; error?: string }>(
    (resolve) => {
      let compiled = false;
      let exited = false;
      
      runner.runSketch(
        sketch,
        (line: string) => {
          outputs.push(line);
        },
        (error: string) => {
          // onError - compilation or runtime errors
          resolve({ outputs, success: false, error });
        },
        (code: number | null) => {
          // onExit
          exited = true;
          if (compiled || outputs.length > 0) {
            resolve({ outputs, success: true });
          }
          // If neither condition met, wait for fallback timer
        },
        (error: string) => {
          // onCompileError
          resolve({ outputs, success: false, error: `Compile: ${error}` });
        },
        () => {
          // onCompileSuccess
          compiled = true;
        },
        () => {}, // onPinState
        timeout, // timeoutSec
        (registry, baudrate) => {
          // onIORegistry - triggers message queue flush
        }
      );
      
      // Fallback timeout - resolve with whatever we have
      setTimeout(() => {
        if (!exited && !compiled) {
          resolve({
            outputs,
            success: false,
            error: `Never started compiling. Runner state: ${runner.simulationState}`,
          });
        } else if (compiled && !exited) {
          // Compiled but process didn't exit yet - resolve with current outputs
          resolve({ outputs, success: outputs.length > 0 });
        }
      }, fallbackTimeout);
    }
  );
  
  return result;
}
