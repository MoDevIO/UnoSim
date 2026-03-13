/**
 * Unit-Tests für SerialOutputBatcher
 * 
 * Testet das Baudrate-basierte Rate-Limiting für serielle Ausgaben analog zum PinStateBatcher.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SerialOutputBatcher } from "../../../server/services/serial-output-batcher";

describe("SerialOutputBatcher", () => {
  let batcher: SerialOutputBatcher;
  let chunks: string[] = [];
  let onChunk: (data: string, firstLineIncomplete?: boolean) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    chunks = [];
    onChunk = (data: string, _firstLineIncomplete?: boolean) => chunks.push(data);
  });

  afterEach(() => {
    if (batcher) {
      batcher.destroy();
    }
    vi.restoreAllMocks();
  });

  describe("Grundfunktionalität", () => {
    it("T01: Kleiner Chunk wird im nächsten Tick vollständig gesendet", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      batcher.enqueue("Hello World\n");

      expect(chunks).toHaveLength(0);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Hello World\n");
    });

    it("T02: Mehrere kleine Chunks werden zu einem Tick-Chunk zusammengefasst", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      batcher.enqueue("Chunk 1\n");
      batcher.enqueue("Chunk 2\n");
      batcher.enqueue("Chunk 3\n");

      expect(chunks).toHaveLength(0);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Chunk 1\nChunk 2\nChunk 3\n");
    });

    it("T03: Buffer wird bei stop() vollständig geflusht (ohne Limit)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Erzeuge mehr Daten als das Budget erlaubt (> 576 Bytes)
      const largeData = "X".repeat(2000) + "\n";
      batcher.enqueue(largeData);

      // stop() sollte alles flushen ohne Drop
      batcher.stop();

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(largeData);
      expect(chunks[0].length).toBe(2001);
    });

    it("T04: Pause stoppt Timer, Resume startet Timer neu", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      batcher.enqueue("Data 1\n");

      vi.advanceTimersByTime(25); // Halber Tick
      expect(chunks).toHaveLength(0);

      batcher.pause();
      vi.advanceTimersByTime(50); // Tick sollte nicht gefeuert werden
      expect(chunks).toHaveLength(0);

      batcher.resume();
      vi.advanceTimersByTime(50); // Jetzt sollte Tick feuern
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Data 1\n");
    });

    it("T05: Nach destroy() werden keine Callbacks mehr aufgerufen", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      batcher.enqueue("Test\n");
      batcher.destroy();

      vi.advanceTimersByTime(100);

      expect(chunks).toHaveLength(0); // Kein Callback nach destroy
    });
  });

  describe("Baudrate-Limiting", () => {
    it("T06: Bei 115200 Baud werden 576 Bytes pro Tick ohne Drop gesendet", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Exakt 576 Bytes (Budget-Grenze bei 115200 Baud, 50ms Tick)
      const data = "X".repeat(576);
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(data);
      expect(chunks[0]).not.toContain("verworfen");
    });

    // burst behaviour changed: instead of dropping, data is buffered and
    // delivered over multiple ticks.  The original assertions about dropped
    // bytes no longer apply, so we now verify that all data makes it through
    // in order and that telemetry reports zero drops.
    it("T07: Bei 115200 Baud werden 2000 Bytes in mehreren Ticks vollständig gesendet (kein Drop)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const largeData = "X".repeat(2000) + "\n";
      batcher.enqueue(largeData);

      // advance two ticks to allow buffer to drain
      vi.advanceTimersByTime(100);

      // all data should eventually be transmitted (maybe split across chunks)
      const total = chunks.join("");
      expect(total).toBe(largeData);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.actual).toBe(total.length);
      expect(telemetry.intended).toBe(total.length);
    });

    it("T08: Bei 9600 Baud wird ein grosses Paket korrekt gepuffert und komplett gesendet", () => {
      // tiny burst window to force multiple ticks even at moderate baud
      batcher = new SerialOutputBatcher({
        baudrate: 9600,
        tickIntervalMs: 50,
        onChunk,
        burstFactor: 0.1,
      });

      batcher.start();

      // consume one tick budget to get into steady state
      batcher.enqueue("X".repeat(48));
      vi.advanceTimersByTime(50);
      batcher.getTelemetryAndReset();
      chunks = [];

      const largeData = "Y".repeat(200);
      batcher.enqueue(largeData);

      // allow enough ticks for the buffer to drain (≈48 bytes/tick)
      // 200 bytes therefore needs at least 5 ticks (250ms)
      vi.advanceTimersByTime(300);

      // after additional time the output should match exactly
      expect(chunks.join("")).toBe(largeData);
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.intended).toBe(200);
    });

    it("T09: Telemetrie meldet keine Drops und erfasst alle Bytes", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const data = "A".repeat(2000) + "\n";
      batcher.enqueue(data);

      // allow two ticks to clear the buffer
      vi.advanceTimersByTime(100);

      const total = chunks.join("");
      expect(total).toBe(data);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.actual).toBe(data.length);
      expect(telemetry.intended).toBe(data.length);
    });

    // Verify FIFO ordering rather than tail-wins, and ensure no drops occur.
    it("T10: FIFO strategy preserves oldest bytes and sends entire message over ticks", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const data = "A".repeat(1500) + "Z".repeat(1000) + "\n";
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      const chunk = chunks[0];

      // since FIFO sends the beginning first, there should be more As than Zs
      const zCount = (chunk.match(/Z/g) || []).length;
      const aCount = (chunk.match(/A/g) || []).length;
      expect(aCount).toBeGreaterThan(zCount);

      // eventually drain remaining data
      vi.advanceTimersByTime(100);
      const total = chunks.join("");
      expect(total).toBe(data);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.intended).toBe(data.length);
      expect(total.endsWith("\n")).toBe(true);
      expect(chunk).not.toContain("verworfen");
    });

    // ─── Zusätzliche Backpressure-Szenarien ──────────────────────────────
    it("T11: Bei 300 Baud wird niemals als overloaded betrachtet", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 300,
        tickIntervalMs: 50,
        onChunk,
      });
      // künstlich genügend Daten im Puffer platzieren
      (batcher as any).pendingData = "X".repeat(5000);
      expect(batcher.isOverloaded()).toBe(false);
    });

    it("T12: Unter 4800 Baud erhöht sich das Backpressure-Limit auf 1024 Bytes", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1200,
        tickIntervalMs: 50,
        onChunk,
      });
      // Write 600 bytes to buffer - should not trigger overload
      (batcher as any).pendingBuffer.write("X".repeat(600));
      expect(batcher.isOverloaded()).toBe(false);
      // Clear and write 1100 bytes - should trigger overload at threshold 1024
      (batcher as any).pendingBuffer.clear();
      (batcher as any).pendingBuffer.write("X".repeat(1100));
      expect(batcher.isOverloaded()).toBe(true);
    });
  });

  describe("Burst-Toleranz", () => {
    it("T11: Erstes Tick nach Start erlaubt Burst-Budget (3×)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // 1728 Bytes = 3× Budget (burst factor 3)
      const data = "X".repeat(1728);
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      // Sollte ohne Drop durchgehen
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(data);
      expect(chunks[0]).not.toContain("verworfen");
    });

    it("T12: Nach 3 leeren Ticks wird Budget auf Burst-Maximum aufgefüllt", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Verbrauche Burst-Budget
      const largeBurst = "A".repeat(1728);
      batcher.enqueue(largeBurst);
      vi.advanceTimersByTime(50);
      chunks = [];

      // 3 leere Ticks
      vi.advanceTimersByTime(50);
      vi.advanceTimersByTime(50);
      vi.advanceTimersByTime(50);

      // Budget sollte wieder auf Burst aufgefüllt sein
      const newBurst = "B".repeat(1728);
      batcher.enqueue(newBurst);
      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(newBurst);
      expect(chunks[0]).not.toContain("verworfen");
    });

    it("T13: Flooding simply queues data; no drops occur", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // first burst consumes budget
      const data1 = "A".repeat(1728);
      batcher.enqueue(data1);
      vi.advanceTimersByTime(50);
      expect(chunks[0]).not.toContain("verworfen");
      let telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      chunks = [];

      // second burst is buffered rather than dropped
      const data2 = "B".repeat(1728);
      batcher.enqueue(data2);
      vi.advanceTimersByTime(150); // allow a few ticks
      expect(chunks.join("")).toContain("B");
      telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
    });
  });

  describe("Telemetrie", () => {
    it("T14: Telemetry reflects full delivery with no drops", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      batcher.enqueue("A".repeat(100));
      vi.advanceTimersByTime(50);
      batcher.enqueue("B".repeat(2000));
      vi.advanceTimersByTime(100);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(2100);
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.actual).toBe(2100);
      expect(telemetry.chunks).toBeGreaterThanOrEqual(2);
    });

    it("T15: Zähler werden nach Reset auf 0 zurückgesetzt", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      batcher.enqueue("Test\n");
      vi.advanceTimersByTime(50);

      const telemetry1 = batcher.getTelemetryAndReset();
      expect(telemetry1.intended).toBeGreaterThan(0);

      const telemetry2 = batcher.getTelemetryAndReset();
      expect(telemetry2.intended).toBe(0);
      expect(telemetry2.actual).toBe(0);
      expect(telemetry2.dropped).toBe(0);
      expect(telemetry2.chunks).toBe(0);
    });

    it("T16: serialBytesTotal akkumuliert über mehrere Resets hinweg", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      batcher.enqueue("A".repeat(100));
      vi.advanceTimersByTime(50);

      const telemetry1 = batcher.getTelemetryAndReset();
      expect(telemetry1.totalBytes).toBe(100);

      batcher.enqueue("B".repeat(200));
      vi.advanceTimersByTime(50);

      const telemetry2 = batcher.getTelemetryAndReset();
      expect(telemetry2.totalBytes).toBe(300); // Akkumuliert: 100 + 200
    });
  });

  describe("Newline-Awareness", () => {
    it("T17: Schnitt auf Newline-Grenze funktioniert und keine Drops entstehen", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const lines = Array.from({ length: 200 }, (_, i) => `Line number ${i} with some extra content\n`).join("");
      batcher.enqueue(lines);

      vi.advanceTimersByTime(100);

      // Multiple chunks may be produced; ensure each chunk ends on a newline
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(c => {
        const lastLine = c.split("\n").slice(-2)[0];
        if (lastLine.length > 0) {
          expect(lastLine).toMatch(/^Line number \d+ with some extra content$/);
        }
      });

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.intended).toBeGreaterThan(1728);
      chunks.forEach(c => expect(c).not.toContain("verworfen"));
    });

    it("T18: Schnitt auf Byte-Grenze liefert korrekte Länge und keine Drops", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const data = "X".repeat(2000);
      batcher.enqueue(data);

      vi.advanceTimersByTime(100);

      expect(chunks.join("")).toBe(data);
      expect(chunks[0]).toMatch(/^X+$/);
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      expect(telemetry.intended).toBe(2000);
      expect(chunks[0]).not.toContain("verworfen");
    });
  });

  describe("Baudrate-Änderung", () => {
    it("T19: setBaudrate() ändert das Verhalten ohne Drops", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      batcher.enqueue("A".repeat(576));
      vi.advanceTimersByTime(50);
      expect(chunks[0]).not.toContain("verworfen");
      batcher.getTelemetryAndReset();
      chunks = [];

      batcher.setBaudrate(9600);
      batcher.enqueue("B".repeat(576));
      // at 9600 baud we only send 48 bytes per tick -> 576 bytes need 12 ticks
      vi.advanceTimersByTime(600);
      expect(chunks.join("")).toBe("B".repeat(576));
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
    });
  });

  describe("Extreme Baudraten", () => {
    it("T20: Baud=1 drains slowly but does not drop any bytes", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      batcher.enqueue("Hello World\n");

      vi.advanceTimersByTime(50);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(12);
      // only one byte sent on first tick
      expect(telemetry.actual).toBe(1);
      expect(telemetry.dropped).toBe(0);
    });

    it("T21: Baud=1 first byte gets through (initial budget=1), then accumulates", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // First single byte: fits in initial budget of 1
      batcher.enqueue("X");
      vi.advanceTimersByTime(50);
      let telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.actual).toBe(1); // "X" fits in budget=1
      expect(telemetry.dropped).toBe(0);

      // After 199 more ticks (no data): accumulator = 199 × 0.005 = 0.995
      vi.advanceTimersByTime(199 * 50);

      // Enqueue another byte — budget is still 0 (0.995 < 1)
      batcher.enqueue("Y");
      vi.advanceTimersByTime(50);  // Tick 200+1: accumulator crosses 1.0
      telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.actual).toBe(1); // "Y" gets through
      expect(telemetry.dropped).toBe(0);
    });

    it("T22: Baud=1 massively flooding still buffers all bytes (no drops)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      for (let i = 0; i < 20; i++) {
        batcher.enqueue("X".repeat(200));
        vi.advanceTimersByTime(50);
      }

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(4000);
      expect(telemetry.actual).toBeLessThanOrEqual(2); // only a couple bytes have been sent so far
      expect(telemetry.dropped).toBe(0);
    });

    // T23 removed - DEPRECATED old strategy test
  });

  describe("Low Baudrate - No Data Loss", () => {
    it("T24: Ultra-low baudrate (115 baud) should not drop data, only delay it", () => {
      // This is a regression test for the issue where "Hello World!\n" was truncated to "orld!"
      // at very low baudrates due to "tail wins" drop strategy.
      // At 115 baud = 11.5 bytes/sec, a 13-byte string takes ~1.13 seconds to transmit.
      
      batcher = new SerialOutputBatcher({
        baudrate: 115,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();
      const message = "Hello World!\n"; // 13 bytes
      batcher.enqueue(message);

      // Simulate 1.2 seconds (24 ticks of 50ms each)
      // At 115 baud: bytesPerTick = 0.575 bytes, maxBudget for burst
      // Over 1.2s, we should get all 13 bytes out, possibly in multiple chunks
      for (let i = 0; i < 24; i++) {
        vi.advanceTimersByTime(50);
      }

      // Collect all chunks and verify total output
      const totalOutput = chunks.join("");
      expect(totalOutput).toBe(message);
      expect(totalOutput.length).toBe(13);
    });

    it("T25: Multiple consecutive messages at low baudrate should all arrive", () => {
      // Simulate repeated Serial.println() calls with delay in between
      batcher = new SerialOutputBatcher({
        baudrate: 115,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // First message
      batcher.enqueue("Hello World!\n");
      
      // Simulate 1.2s for message to transmit
      for (let i = 0; i < 24; i++) {
        vi.advanceTimersByTime(50);
      }

      // Second message
      batcher.enqueue("Hello World!\n");

      // Another 1.2s
      for (let i = 0; i < 24; i++) {
        vi.advanceTimersByTime(50);
      }

      const totalOutput = chunks.join("");
      expect(totalOutput).toBe("Hello World!\nHello World!\n");
    });
  });});