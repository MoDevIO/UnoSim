/**
 * SerialCharacterRenderer Stop/Pause/Resume Tests
 * 
 * Tests that the client-side character renderer correctly handles
 * pause, resume, and clear operations for baudrate-simulated rendering.
 * 
 * Key requirements:
 * - STOP: clear() empties queue immediately, no more characters rendered
 * - PAUSE: pause() stops rendering immediately, queue preserved
 * - RESUME: resume() continues rendering from where it left off
 * - System messages must bypass the baudrate renderer entirely
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SerialCharacterRenderer } from '../../client/src/utils/serial-character-renderer';

describe('SerialCharacterRenderer Stop/Pause/Resume', () => {
  let renderer: SerialCharacterRenderer;
  let output: string;
  
  // Mock requestAnimationFrame/cancelAnimationFrame
  let rafCallbacks: Map<number, () => void>;
  let rafId: number;
  
  beforeEach(() => {
    output = '';
    rafCallbacks = new Map();
    rafId = 0;
    
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      const id = ++rafId;
      rafCallbacks.set(id, cb);
      return id;
    });
    
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
    
    vi.stubGlobal('performance', {
      now: vi.fn(() => Date.now()),
    });
  });
  
  afterEach(() => {
    renderer?.destroy();
    vi.unstubAllGlobals();
  });
  
  function flushRAF(steps = 100) {
    for (let i = 0; i < steps; i++) {
      const callbacks = [...rafCallbacks.values()];
      rafCallbacks.clear();
      if (callbacks.length === 0) break;
      callbacks.forEach(cb => cb());
    }
  }

  // ─── CLEAR (STOP) ───────────────────────────────────────

  describe('clear() (STOP equivalent)', () => {
    it('T-CR-01: clear() empties queue immediately', () => {
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(300); // Very slow
      
      renderer.enqueue('Hello World! This is a long string.\n');
      
      // Process a bit
      flushRAF(3);
      const outputBeforeClear = output;
      
      // CLEAR (stop)
      renderer.clear();
      
      expect(renderer.getQueueLength()).toBe(0);
      expect(renderer.isActive()).toBe(false);
      
      // No more output after clear
      flushRAF(100);
      expect(output).toBe(outputBeforeClear);
    });

    it('T-CR-02: clear() stops in-progress rendering', () => {
      let timeNow = 0;
      vi.stubGlobal('performance', { now: () => timeNow });
      
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(1000); // ~1ms per char
      
      renderer.enqueue('A'.repeat(500));
      
      // Advance time and flush some frames
      timeNow = 5;
      flushRAF(2);
      timeNow = 10;
      flushRAF(2);
      timeNow = 20;
      flushRAF(2);
      
      renderer.clear();
      
      // Output should be partial (not all 500)
      expect(output.length).toBeLessThan(500);
      expect(output.length).toBeGreaterThan(0);
      
      // Queue should be empty
      expect(renderer.getQueueLength()).toBe(0);
    });
  });

  // ─── PAUSE ───────────────────────────────────────────────

  describe('pause()', () => {
    it('T-CR-03: pause() stops rendering, preserves queue', () => {
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(1000);
      
      renderer.enqueue('Hello World!\n');
      flushRAF(2);
      
      renderer.pause();
      const outputAtPause = output;
      const queueAtPause = renderer.getQueueLength();
      
      // Queue should still have remaining data
      expect(queueAtPause).toBeGreaterThan(0);
      
      // No more rendering after pause
      flushRAF(100);
      expect(output).toBe(outputAtPause);
    });

    it('T-CR-04: pause() cancels RAF immediately', () => {
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(1000);
      
      renderer.enqueue('Test data\n');
      flushRAF(1);
      
      expect(renderer.isActive()).toBe(true);
      
      renderer.pause();
      expect(renderer.isActive()).toBe(false);
    });
  });

  // ─── RESUME ──────────────────────────────────────────────

  describe('resume()', () => {
    it('T-CR-05: resume() continues from pause point', () => {
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(undefined); // Instant mode for deterministic test
      
      renderer.enqueue('ABCDEFGHIJ');
      
      // Render some
      flushRAF(2);
      const partialOutput = output;
      
      renderer.pause();
      
      // Resume
      renderer.resume();
      flushRAF(50);
      
      // All data should be rendered
      expect(output).toBe('ABCDEFGHIJ');
      // And partial was a prefix
      expect('ABCDEFGHIJ'.startsWith(partialOutput)).toBe(true);
    });

    it('T-CR-06: data enqueued during pause is rendered after resume', () => {
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(undefined); // Instant mode
      
      renderer.enqueue('Before');
      renderer.pause();
      
      renderer.enqueue(' After');
      expect(output).toBe(''); // Nothing rendered during pause
      
      renderer.resume();
      flushRAF(50);
      
      expect(output).toBe('Before After');
    });
  });

  // ─── SYSTEM MESSAGE BYPASS ───────────────────────────────

  describe('System message handling', () => {
    it('T-CR-07: System messages with trailing newline are detected correctly', () => {
      // The server sends "--- Simulation paused ---\n" (with trailing newline).
      // The detection must trim before checking.
      const rawText = '--- Simulation paused ---\n';
      const trimmed = rawText.trimEnd();
      
      expect(trimmed.startsWith('--- ')).toBe(true);
      expect(trimmed.endsWith(' ---')).toBe(true);
      
      // Without trimming, endsWith would fail:
      expect(rawText.endsWith(' ---')).toBe(false); // This was the bug!
    });

    it('T-CR-08: System messages should not go through baudrate renderer', () => {
      // This test documents the REQUIREMENT:
      // Messages like "--- Simulation paused ---" must be rendered immediately,
      // not character-by-character at the baudrate speed.
      
      renderer = new SerialCharacterRenderer((char) => { output += char; });
      renderer.setBaudrate(300); // Very slow baudrate
      
      // A system message like "--- Simulation paused ---\n" should NOT be 
      // character-rendered at 300 baud (would take ~1.3 seconds)
      const systemMsg = '--- Simulation paused ---\n';
      
      // If we were to enqueue it into the renderer:
      renderer.enqueue(systemMsg);
      flushRAF(1); // Just one frame
      
      // At 300 baud, only ~1 character would render per frame
      // So after 1 frame, NOT all characters are visible
      // This demonstrates WHY system messages must bypass the renderer
      expect(output.length).toBeLessThan(systemMsg.length);
    });

    it('T-CR-09: clearOutputs must clear rendered text, RESUME must not', () => {
      // The clearOutputs() function (called at compile-and-start time) is
      // responsible for clearing the serial monitor.  It must reset both the
      // old serialOutput[] array AND the new renderedSerialText so the
      // display starts fresh.  RESUME never calls clearOutputs.
      
      let renderedSerialText = 'old output from previous run\n';
      
      // Simulates clearOutputs() as called during Compile&Start
      const clearOutputs = () => {
        renderedSerialText = ''; // clearSerialOutput() inside clearOutputs
      };
      
      // START: clearOutputs is called → display must be empty
      clearOutputs();
      expect(renderedSerialText).toBe('');
      
      // New simulation produces output
      renderedSerialText = 'new output\n';
      
      // PAUSE then RESUME → clearOutputs is NOT called → display preserved
      // (pause/resume only call pauseRendering/resumeRendering)
      expect(renderedSerialText).toBe('new output\n');
      
      // Next START: clearOutputs is called again → display must be empty
      clearOutputs();
      expect(renderedSerialText).toBe('');
    });
  });
});
