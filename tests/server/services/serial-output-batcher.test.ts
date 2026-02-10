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
      expect(chunks[0]).toContain("verworfen");
      expect(chunks[0]).toContain("Baudrate-Limit");
      
      // Mit initialem Burst-Budget (1728) sollten ~273 Bytes gedroppt werden (2001 - 1728)
      const match = chunks[0].match(/(\d+) Bytes verworfen/);
      expect(match).toBeTruthy();
      const droppedBytes = parseInt(match![1], 10);
      expect(droppedBytes).toBeGreaterThan(200);
      expect(droppedBytes).toBeLessThan(400);

      // Die neuesten Daten (Ende des Strings) sollten enthalten sein (Tail wins)
      expect(chunks[0]).toContain("XXX\n"); // Ende des Strings
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

      // 100 Bytes sollten droppen
      chunks = [];
      const largeData = "Y".repeat(100);
      batcher.enqueue(largeData);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain("verworfen");
    });

    it("T09: Drop-Indikator enthält korrekte Byte-Anzahl", () => {
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
      const match = chunks[0].match(/(\d+) Bytes verworfen/);
      expect(match).toBeTruthy();
      const droppedBytes = parseInt(match![1], 10);
      expect(droppedBytes).toBeGreaterThan(200);
      expect(droppedBytes).toBeLessThan(400);
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
      const dataWithoutIndicator = chunks[0].replace(/\[⚠[^\]]+\]/, "");
      const zCount = (dataWithoutIndicator.match(/Z/g) || []).length;
      const aCount = (dataWithoutIndicator.match(/A/g) || []).length;
      expect(zCount).toBeGreaterThan(aCount); // Mehr Zs als As = Tail gewonnen
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
      chunks = [];

      // Zweites großes Paket sofort danach (Burst verbraucht, sollte droppen)
      const data2 = "B".repeat(1728);
      batcher.enqueue(data2);
      vi.advanceTimersByTime(50);

      expect(chunks[0]).toContain("verworfen"); // Jetzt gedroppt
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

      // 2000 Bytes intended (exceeds remaining burst budget)
      // Burst budget after first tick: 1728 - 100 = 1628
      // So ~372 bytes will be dropped
      batcher.enqueue("B".repeat(2000));
      vi.advanceTimersByTime(50);

      const telemetry = batcher.getTelemetryAndReset();

      expect(telemetry.intended).toBe(2100); // 100 + 2000
      expect(telemetry.actual).toBeLessThan(2100);
      expect(telemetry.actual).toBeGreaterThan(1600); // ~1728 total sent
      expect(telemetry.dropped).toBeGreaterThan(300);
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
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}\n`).join("");
      batcher.enqueue(lines);

      vi.advanceTimersByTime(50);

      expect(chunks).toHaveLength(1);
      
      // Der Output sollte nicht mit halben Zeilen enden
      const dataWithoutIndicator = chunks[0].replace(/^\[⚠[^\]]+\]\n/, "");
      const lastLine = dataWithoutIndicator.split("\n").slice(-2)[0]; // Vorletzte Zeile (letzte ist leer)
      
      // Sollte eine vollständige Zeile sein
      expect(lastLine).toMatch(/^Line \d+$/);
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
      expect(chunks[0]).toContain("verworfen");
      
      // Sollte bei Byte-Grenze geschnitten haben (mit Burst-Budget)
      const dataWithoutIndicator = chunks[0].replace(/^\[⚠[^\]]+\]\n/, "");
      expect(dataWithoutIndicator.length).toBeLessThanOrEqual(1728); // Burst-Budget
      expect(dataWithoutIndicator).toMatch(/^X+$/); // Nur Xs, kein Newline
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
      chunks = [];

      // Baudrate auf 9600 ändern (Budget = 48 Bytes)
      batcher.setBaudrate(9600);

      // 576 Bytes sollten jetzt droppen
      batcher.enqueue("B".repeat(576));
      vi.advanceTimersByTime(50);
      expect(chunks[0]).toContain("verworfen");
    });
  });
});
