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
  let onChunk: (data: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    chunks = [];
    onChunk = (data: string) => chunks.push(data);
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

    it("T07: Bei 115200 Baud werden 2000 Bytes teilweise gedroppt wenn Burst verbraucht", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const largeData = "X".repeat(2000) + "\n";
      batcher.enqueue(largeData);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      
      // Mit initialem Burst-Budget (1728) sollten ~273 Bytes gedroppt werden (2001 - 1728)
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(200);
      expect(telemetry.dropped).toBeLessThan(400);
      expect(telemetry.intended).toBe(2001);
      expect(telemetry.actual).toBe(2001 - telemetry.dropped);

      // Die neuesten Daten (Ende des Strings) sollten enthalten sein (Tail wins)
      expect(chunks[0]).toContain("XXX\n"); // Ende des Strings
      // Drop-Indikator sollte NICHT mehr im Output sein
      expect(chunks[0]).not.toContain("verworfen");
      expect(chunks[0]).not.toContain("Baudrate-Limit");
    });

    it("T08: Bei 9600 Baud werden 48 Bytes pro Tick zugelassen", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 9600,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // 48 Bytes = Budget bei 9600 Baud, 50ms Tick
      const data = "X".repeat(48);
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(data);
      expect(chunks[0]).not.toContain("verworfen");
      
      // Reset telemetry after first tick
      batcher.getTelemetryAndReset();

      // At 9600 baud: normalBudget = 48 bytes/tick, maxBudget = 144
      // After first tick: currentBudget = 144 - 48 = 96
      // After second tick refill: min(96 + 48, 144) = 144
      // So 100 bytes fits in 144 budget — no drop.
      // To trigger a drop, we need > 144 bytes (maxBudget)
      chunks = [];
      const largeData = "Y".repeat(200); // > 144 = must drop
      batcher.enqueue(largeData);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      // Telemetrie prüfen statt Output-Text
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      expect(telemetry.intended).toBe(200);
      // Drop-Indikator sollte NICHT im Output sein
      expect(chunks[0]).not.toContain("verworfen");
    });

    it("T09: Telemetrie enthält korrekte Drop-Byte-Anzahl", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      const data = "A".repeat(2000) + "\n";
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      
      // Dropped = 2001 - 1728 (burst budget) = 273 Bytes (ca.)
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(200);
      expect(telemetry.dropped).toBeLessThan(400);
      expect(telemetry.intended).toBe(2001);
      expect(telemetry.actual).toBe(2001 - telemetry.dropped);
      
      // Drop-Indikator sollte NICHT im Output sein
      expect(chunks[0]).not.toContain("verworfen");
    });

    it("T10: Tail wins — die neuesten Bytes werden behalten, älteste verworfen", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Eindeutiges Muster: Anfang mit AAAA, Ende mit ZZZZZZ
      // Erzeuge mehr Daten als Burst-Budget (>1728)
      // Mit Burst-Budget von 1728 sollte am Ende ~1728 Bytes bleiben
      const data = "A".repeat(1500) + "Z".repeat(1000) + "\n";
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      // Die neuesten Daten (ZZZZ\n) sollten vorhanden sein
      expect(chunks[0]).toContain("ZZZZ");
      expect(chunks[0]).toMatch(/Z+\n$/);
      
      // Die ältesten Daten (erstes A-Block am Anfang) sollten verworfen sein
      // Prüfe dass der String überwiegend Zs enthält (tail wins)
      const zCount = (chunks[0].match(/Z/g) || []).length;
      const aCount = (chunks[0].match(/A/g) || []).length;
      expect(zCount).toBeGreaterThan(aCount); // Mehr Zs als As = Tail gewonnen
      
      // Telemetrie sollte Drops zeigen
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      expect(telemetry.intended).toBe(2501); // 1500 + 1000 + 1
      
      // Output sollte KEINEN Drop-Indikator enthalten
      expect(chunks[0]).not.toContain("verworfen");
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

    it("T13: Dauerhaftes Flooding verbraucht Burst und droppt danach konsequent", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Erstes großes Paket (nutzt Burst)
      const data1 = "A".repeat(1728);
      batcher.enqueue(data1);
      vi.advanceTimersByTime(50);

      expect(chunks[0]).not.toContain("verworfen"); // Burst-Budget genutzt
      let telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0); // Kein Drop beim ersten Burst
      chunks = [];

      // Zweites großes Paket sofort danach (Burst verbraucht, sollte droppen)
      const data2 = "B".repeat(1728);
      batcher.enqueue(data2);
      vi.advanceTimersByTime(50);

      // Telemetrie sollte Drops zeigen
      telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      // Output sollte KEINEN Drop-Indikator enthalten
      expect(chunks[0]).not.toContain("verworfen");
    });
  });

  describe("Telemetrie", () => {
    it("T14: getTelemetryAndReset() liefert korrekte intended/actual/dropped Zähler", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // 100 Bytes intended (fits in burst budget)
      batcher.enqueue("A".repeat(100));
      vi.advanceTimersByTime(50);

      // 2000 Bytes intended (exceeds budget after refill)
      // After first tick: currentBudget = 1728 - 100 = 1628
      // Second tick refill: min(1628 + 576, 1728) = 1728
      // 2000 > 1728 → dropped = 2000 - 1728 = 272
      batcher.enqueue("B".repeat(2000));
      vi.advanceTimersByTime(50);

      const telemetry = batcher.getTelemetryAndReset();

      expect(telemetry.intended).toBe(2100); // 100 + 2000
      expect(telemetry.actual).toBeLessThan(2100);
      expect(telemetry.actual).toBeGreaterThan(1500); // ~1728 total sent
      expect(telemetry.dropped).toBeGreaterThan(200); // ~272 bytes dropped
      expect(telemetry.dropped).toBeLessThan(500);
      expect(telemetry.chunks).toBe(2); // 2 Ticks
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
    it("T17: Schnitt erfolgt auf Newline-Grenze (keine halben Zeilen)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Erzeuge mehrere Zeilen, die zusammen das Budget überschreiten
      // Burst-Budget bei 115200 ist 1728 Bytes. Mit längeren Zeilen erzwingen wir Drops.
      const lines = Array.from({ length: 200 }, (_, i) => `Line number ${i} with some extra content\n`).join("");
      batcher.enqueue(lines);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      
      // Der Output sollte nicht mit halben Zeilen enden
      const lastLine = chunks[0].split("\n").slice(-2)[0]; // Vorletzte Zeile (letzte ist leer)
      
      // Sollte eine vollständige Zeile sein (entweder vollständig oder leer falls nur \n am Ende)
      if (lastLine.length > 0) {
        expect(lastLine).toMatch(/^Line number \d+ with some extra content$/);
      }
      
      // Telemetrie sollte Drops zeigen (weil Budget überschritten)
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      expect(telemetry.intended).toBeGreaterThan(1728); // Mehr als Burst-Budget
      // Output sollte KEINEN Drop-Indikator enthalten
      expect(chunks[0]).not.toContain("verworfen");
    });

    it("T18: Wenn kein Newline im Budget-Bereich, wird auf Byte-Grenze geschnitten", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Lange Zeile ohne Newlines (> Burst-Budget)
      const data = "X".repeat(2000);
      batcher.enqueue(data);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      
      // Sollte bei Byte-Grenze geschnitten haben (mit Burst-Budget)
      expect(chunks[0].length).toBeLessThanOrEqual(1728); // Burst-Budget
      expect(chunks[0]).toMatch(/^X+$/); // Nur Xs, kein Newline
      
      // Telemetrie sollte Drops zeigen
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      expect(telemetry.intended).toBe(2000);
      // Output sollte KEINEN Drop-Indikator enthalten
      expect(chunks[0]).not.toContain("verworfen");
    });
  });

  describe("Baudrate-Änderung", () => {
    it("T19: setBaudrate() ändert das Byte-Budget für den nächsten Tick", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 115200,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // 576 Bytes sollten bei 115200 durchgehen
      batcher.enqueue("A".repeat(576));
      vi.advanceTimersByTime(50);
      expect(chunks[0]).not.toContain("verworfen");
      let telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBe(0);
      chunks = [];

      // Baudrate auf 9600 ändern (Budget = 48 Bytes)
      batcher.setBaudrate(9600);

      // 576 Bytes sollten jetzt droppen
      batcher.enqueue("B".repeat(576));
      vi.advanceTimersByTime(50);
      
      // Telemetrie sollte Drops zeigen
      telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.dropped).toBeGreaterThan(0);
      // Output sollte KEINEN Drop-Indikator enthalten
      expect(chunks[0]).not.toContain("verworfen");
    });
  });

  describe("Extreme Baudraten", () => {
    it("T20: Baud=1 drops almost everything (maxBudget=1)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1,
        tickIntervalMs: 50,
        onChunk,
      });

      // At baud=1: bytesPerTick = 0.005, burstBudget = 0.015, maxBudget = 1
      batcher.start();
      batcher.enqueue("Hello World\n");

      vi.advanceTimersByTime(50);

      // Budget=1, data=12 bytes. Tail-wins keeps last 1 byte ("\n"),
      // then newline-adjustment skips past it → 12 dropped, 0 actual
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(12);
      expect(telemetry.dropped).toBe(12); // All dropped after newline adjustment
      expect(telemetry.actual).toBe(0);
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

    it("T22: Baud=1 massive flooding counts drops correctly", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 1,
        tickIntervalMs: 50,
        onChunk,
      });

      batcher.start();

      // Simulate 1 second of flooding: 20 ticks × 200 bytes
      for (let i = 0; i < 20; i++) {
        batcher.enqueue("X".repeat(200));
        vi.advanceTimersByTime(50);
      }

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(4000); // 20 × 200
      // maxBudget=1, initial budget=1, then 0.1 bytes accumulated over 1s = 0 more whole bytes
      // So only 1 byte gets through total, rest dropped
      expect(telemetry.actual).toBeLessThanOrEqual(2);
      expect(telemetry.dropped).toBeGreaterThan(3990);
    });

    it("T23: Baud=300 budget is proportional floor (15 bytes)", () => {
      batcher = new SerialOutputBatcher({
        baudrate: 300,
        tickIntervalMs: 50,
        onChunk,
      });

      // At 300 baud: bytesPerTick = 1.5, burstBudget = 4.5
      // Proportional floor: min(50, ceil(30 × 0.5)) = min(50, 15) = 15
      // maxBudget = max(1, 4, 15) = 15
      batcher.start();
      batcher.enqueue("Hello World!\n"); // 14 bytes — fits in maxBudget of 15

      vi.advanceTimersByTime(50);

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.actual).toBe(13); // "Hello World!\n" = 13 bytes, fits in budget of 15
      expect(telemetry.dropped).toBe(0);

      // Now send 30 bytes — exceeds remaining budget after refill
      chunks = [];
      batcher.enqueue("A".repeat(30));
      vi.advanceTimersByTime(50);

      const telemetry2 = batcher.getTelemetryAndReset();
      // currentBudget was 15-14=1, refill from accumulator ~1-2 → budget ~2-3
      // 30 > 3 → drops
      expect(telemetry2.dropped).toBeGreaterThan(0);
    });
  });
});
