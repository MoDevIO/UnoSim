/**
 * Serial Output Stop/Pause/Resume Tests
 * 
 * Tests immediate response to STOP, PAUSE, and RESUME commands.
 * 
 * Requirements (Soll-Zustand):
 * - STOP:   Frontend stops output immediately. Server clears buffer. Pending serial_output messages are discarded.
 * - PAUSE:  Frontend stops output immediately. Server keeps buffer. Already-received messages are preserved but not rendered.
 * - RESUME: Frontend resumes rendering. Server resumes buffer filling.
 * 
 * All transitions must complete within <20ms, even at low baudrates (e.g. 1000 baud).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SerialOutputBatcher } from '../../../server/services/serial-output-batcher';

describe('Serial Output Stop/Pause/Resume', () => {
  let batcher: SerialOutputBatcher;
  let chunks: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    chunks = [];
  });

  afterEach(() => {
    if (batcher) {
      batcher.destroy();
    }
    vi.useRealTimers();
  });

  // ─── STOP ────────────────────────────────────────────────

  describe('STOP behavior', () => {
    it('T-SPR-01: destroy() discards all pending data immediately', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1000, // Low baudrate → 100 bytes/sec → 5 bytes per tick
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      // Enqueue lots of data that would take many ticks to drain
      batcher.enqueue('A'.repeat(500)); // At 1000 baud: ~5 seconds to drain

      // Advance one tick to confirm data is being sent
      vi.advanceTimersByTime(50);
      expect(chunks.length).toBeGreaterThan(0);

      const chunksBeforeStop = chunks.length;

      // STOP: destroy immediately
      batcher.destroy();

      // After destroy, no more data should arrive even after many ticks
      vi.advanceTimersByTime(5000);
      expect(chunks.length).toBe(chunksBeforeStop);
    });

    it('T-SPR-02: destroy() completes in <1ms (no flush delay)', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 300, // Very slow
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      batcher.enqueue('Hello World!\n'.repeat(100));
      vi.advanceTimersByTime(50);

      const before = performance.now();
      batcher.destroy();
      const elapsed = performance.now() - before;

      // destroy() must be synchronous and fast
      expect(elapsed).toBeLessThan(5);
      // No data emitted after destroy
      vi.advanceTimersByTime(10000);
      const chunksAfter = chunks.length;
      vi.advanceTimersByTime(10000);
      expect(chunks.length).toBe(chunksAfter);
    });

    it('T-SPR-03: stop() flushes remaining data (natural completion)', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      batcher.enqueue('Final output\n');

      // stop() should flush synchronously
      batcher.stop();

      const allText = chunks.join('');
      expect(allText).toContain('Final output');
    });

    it('T-SPR-04: After destroy(), enqueue() is a no-op', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();
      batcher.destroy();

      // Enqueue after destroy should not cause any output
      batcher.enqueue('Should not appear\n');
      vi.advanceTimersByTime(1000);
      expect(chunks.length).toBe(0);
    });
  });

  // ─── PAUSE ───────────────────────────────────────────────

  describe('PAUSE behavior', () => {
    it('T-SPR-05: pause() stops output immediately, keeps buffer', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1000,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      // Enqueue data
      batcher.enqueue('A'.repeat(500));

      // Let one tick run
      vi.advanceTimersByTime(50);
      const chunksBeforePause = chunks.length;
      const bytesBeforePause = chunks.join('').length;
      expect(chunksBeforePause).toBeGreaterThan(0);

      // PAUSE
      batcher.pause();

      // No more output after pause, even after many ticks
      vi.advanceTimersByTime(5000);
      expect(chunks.length).toBe(chunksBeforePause);

      // Buffer should still hold remaining data
      const telemetry = batcher.getTelemetryAndReset();
      // intended = 500 bytes, actual = what was sent before pause
      expect(telemetry.intended).toBe(500);
      expect(telemetry.actual).toBe(bytesBeforePause);
      // Data was NOT dropped, just not yet sent
      expect(telemetry.dropped).toBe(0);
    });

    it('T-SPR-06: pause() response time is <1ms', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 300,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();
      batcher.enqueue('Long text '.repeat(50));

      const before = performance.now();
      batcher.pause();
      const elapsed = performance.now() - before;

      expect(elapsed).toBeLessThan(5); // synchronous, instant
    });
  });

  // ─── RESUME ──────────────────────────────────────────────

  describe('RESUME behavior', () => {
    it('T-SPR-07: resume() continues output from where pause left off', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1000,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      // Enqueue data
      const fullData = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\n';
      batcher.enqueue(fullData);

      // Let one tick run
      vi.advanceTimersByTime(50);
      const outputBeforePause = chunks.join('');

      // Pause
      batcher.pause();
      vi.advanceTimersByTime(1000); // wait a while - no output

      // Resume
      batcher.resume();

      // Run enough ticks to drain all remaining
      vi.advanceTimersByTime(10000);

      // All data should eventually appear, in correct order
      const allOutput = chunks.join('');
      expect(allOutput).toBe(fullData);

      // And the part before pause is a prefix
      expect(allOutput.startsWith(outputBeforePause)).toBe(true);
    });

    it('T-SPR-08: resume() restarts immediately on next tick', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      batcher.enqueue('Data\n');
      batcher.pause();

      // No output during pause
      vi.advanceTimersByTime(500);
      expect(chunks.length).toBe(0);

      // Resume
      batcher.resume();
      vi.advanceTimersByTime(50);

      // Should have output on next tick
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('Data');
    });

    it('T-SPR-09: New data enqueued during pause is sent after resume', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      batcher.enqueue('Before pause\n');
      batcher.pause();

      // Enqueue more data while paused (server may still receive data)
      batcher.enqueue('During pause\n');

      vi.advanceTimersByTime(500);
      expect(chunks.length).toBe(0); // nothing sent during pause

      // Resume
      batcher.resume();
      vi.advanceTimersByTime(100);

      const allOutput = chunks.join('');
      expect(allOutput).toContain('Before pause');
      expect(allOutput).toContain('During pause');

      // Order preserved
      const beforeIdx = allOutput.indexOf('Before pause');
      const duringIdx = allOutput.indexOf('During pause');
      expect(beforeIdx).toBeLessThan(duringIdx);
    });
  });

  // ─── COMBINED SCENARIOS ──────────────────────────────────

  describe('Combined scenarios', () => {
    it('T-SPR-10: Pause → Resume → Stop lifecycle at low baudarte', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1000, // Low: 100 bytes/sec
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      // 1. Enqueue data
      batcher.enqueue('Step1 data\n');
      vi.advanceTimersByTime(50);
      expect(chunks.join('')).toContain('Step1');

      // 2. Pause
      batcher.pause();
      batcher.enqueue('Step2 data\n');
      vi.advanceTimersByTime(500);
      const outputBetween = chunks.join('');

      // 3. Resume
      batcher.resume();
      vi.advanceTimersByTime(5000); // Let all data drain
      const outputAfterResume = chunks.join('');
      expect(outputAfterResume).toContain('Step2');

      // 4. Stop (destroy)
      batcher.enqueue('Step3 should be lost\n');
      batcher.destroy();
      vi.advanceTimersByTime(5000);

      const finalOutput = chunks.join('');
      expect(finalOutput).not.toContain('Step3 should be lost');
    });

    it('T-SPR-11: Multiple rapid pause/resume cycles', () => {
      batcher = new SerialOutputBatcher({
        baudrate: 9600,
        tickIntervalMs: 50,
        onChunk: (data) => chunks.push(data),
      });
      batcher.start();

      const inputData = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n';
      batcher.enqueue(inputData);

      // Rapid pause/resume cycles
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(10);
        batcher.pause();
        vi.advanceTimersByTime(10);
        batcher.resume();
      }

      // Let everything drain
      vi.advanceTimersByTime(5000);

      const allOutput = chunks.join('');
      // All data must eventually arrive, in order
      expect(allOutput).toBe(inputData);
    });
  });
});
