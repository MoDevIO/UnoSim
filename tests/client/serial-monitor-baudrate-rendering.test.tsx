/**
 * Serial Monitor Baudrate-Based Character Rendering Tests
 * 
 * Diese Tests validieren, dass Zeichen im Serial Monitor entsprechend
 * der konfigurierten Baudrate verzögert dargestellt werden, anstatt
 * als komplette Telegramme sofort zu erscheinen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useSerialIO } from "@/hooks/use-serial-io";
import { act } from "react";
import React from "react";

// Mock component that uses useSerialIO
function TestSerialMonitor({ baudrate = 9600 }: { baudrate?: number }) {
  const { serialOutput, appendSerialOutput, setBaudrate } = useSerialIO();
  
  React.useEffect(() => {
    setBaudrate(baudrate);
  }, [baudrate, setBaudrate]);

  return (
    <div>
      <div data-testid="serial-output">{serialOutput}</div>
      <button
        onClick={() => appendSerialOutput("Hello World\n")}
        data-testid="append-btn"
      >
        Append
      </button>
    </div>
  );
}

// PHASE 2-3: These tests will be enabled when hook integration is complete
describe.skip("Serial Monitor - Baudrate-Based Character Rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("T-BAUD-RENDER-01: Langsame Baudrate (300 Baud)", () => {
    it("sollte Zeichen bei 300 Baud einzeln mit ~33ms Verzögerung anzeigen", async () => {
      // 300 Baud = 30 bytes/s = 33.3ms pro Zeichen
      const { getByTestId } = render(<TestSerialMonitor baudrate={300} />);
      const output = getByTestId("serial-output");

      act(() => {
        getByTestId("append-btn").click();
      });

      // Nach 0ms: Noch nichts sichtbar
      expect(output.textContent).toBe("");

      // Nach 33ms: Erstes Zeichen 'H'
      act(() => {
        vi.advanceTimersByTime(33);
      });
      await waitFor(() => expect(output.textContent).toBe("H"));

      // Nach 66ms: Zweites Zeichen 'e'
      act(() => {
        vi.advanceTimersByTime(33);
      });
      await waitFor(() => expect(output.textContent).toBe("He"));

      // Nach ~400ms: Alle 12 Zeichen sichtbar
      act(() => {
        vi.advanceTimersByTime(400);
      });
      await waitFor(() => expect(output.textContent).toBe("Hello World\n"));
    });
  });

  describe("T-BAUD-RENDER-02: Mittlere Baudrate (9600 Baud)", () => {
    it("sollte Zeichen bei 9600 Baud mit ~1ms Verzögerung anzeigen", async () => {
      // 9600 Baud = 960 bytes/s = 1.04ms pro Zeichen
      const { getByTestId } = render(<TestSerialMonitor baudrate={9600} />);
      const output = getByTestId("serial-output");

      act(() => {
        getByTestId("append-btn").click();
      });

      // Nach 0ms: Noch nichts
      expect(output.textContent).toBe("");

      // Nach 1ms: Erstes Zeichen
      act(() => {
        vi.advanceTimersByTime(1);
      });
      await waitFor(() => expect(output.textContent).toBe("H"));

      // Nach 13ms: Alle 12 Zeichen (12 × 1.04ms ≈ 13ms)
      act(() => {
        vi.advanceTimersByTime(12);
      });
      await waitFor(() => expect(output.textContent).toBe("Hello World\n"));
    });
  });

  describe("T-BAUD-RENDER-03: Hohe Baudrate (115200 Baud)", () => {
    it("sollte bei 115200 Baud fast sofort rendern (< 1ms pro Zeichen)", async () => {
      // 115200 Baud = 11520 bytes/s = 0.087ms pro Zeichen
      const { getByTestId } = render(<TestSerialMonitor baudrate={115200} />);
      const output = getByTestId("serial-output");

      act(() => {
        getByTestId("append-btn").click();
      });

      // Nach 2ms: Alle Zeichen sollten sichtbar sein (12 × 0.087ms ≈ 1ms)
      act(() => {
        vi.advanceTimersByTime(2);
      });
      await waitFor(() => expect(output.textContent).toBe("Hello World\n"));
    });
  });

  describe("T-BAUD-RENDER-04: Mehrere Chunks hintereinander", () => {
    it("sollte mehrere Chunks sequenziell mit korrekter Verzögerung rendern", async () => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={300} />);
      const output = getByTestId("serial-output");
      const { appendSerialOutput } = useSerialIO.getState();

      // Chunk 1: "ABC"
      act(() => {
        appendSerialOutput("ABC");
      });

      act(() => {
        vi.advanceTimersByTime(100); // 3 Zeichen × 33ms = 99ms
      });
      await waitFor(() => expect(output.textContent).toBe("ABC"));

      // Chunk 2: "DEF" (sollte direkt danach starten)
      act(() => {
        appendSerialOutput("DEF");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });
      await waitFor(() => expect(output.textContent).toBe("ABCDEF"));
    });
  });

  describe("T-BAUD-RENDER-05: Baudrate-Änderung während Rendering", () => {
    it("sollte aktuelle Rendering-Geschwindigkeit bei Baudrate-Änderung anpassen", async () => {
      const { getByTestId, rerender } = render(<TestSerialMonitor baudrate={300} />);
      const output = getByTestId("serial-output");

      act(() => {
        getByTestId("append-btn").click(); // "Hello World\n"
      });

      // 2 Zeichen bei 300 Baud (66ms)
      act(() => {
        vi.advanceTimersByTime(66);
      });
      await waitFor(() => expect(output.textContent).toBe("He"));

      // Baudrate auf 9600 erhöhen
      rerender(<TestSerialMonitor baudrate={9600} />);

      // Restliche 10 Zeichen sollten jetzt schneller kommen (10 × 1ms = 10ms)
      act(() => {
        vi.advanceTimersByTime(15);
      });
      await waitFor(() => expect(output.textContent).toBe("Hello World\n"));
    });
  });

  describe("T-BAUD-RENDER-06: Pause während Character-Rendering", () => {
    it("sollte Character-Rendering pausieren und bei Resume fortsetzen", async () => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={300} />);
      const output = getByTestId("serial-output");
      const { appendSerialOutput, pauseRendering, resumeRendering } = useSerialIO.getState();

      act(() => {
        appendSerialOutput("ABCDEF");
      });

      // 2 Zeichen rendern
      act(() => {
        vi.advanceTimersByTime(66);
      });
      await waitFor(() => expect(output.textContent).toBe("AB"));

      // Pausieren
      pauseRendering();

      // Zeit vergeht, aber nichts passiert
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(output.textContent).toBe("AB");

      // Resume
      resumeRendering();

      // Restliche Zeichen sollten jetzt kommen
      act(() => {
        vi.advanceTimersByTime(132); // 4 × 33ms
      });
      await waitFor(() => expect(output.textContent).toBe("ABCDEF"));
    });
  });

  describe("T-BAUD-RENDER-07: Clear während Character-Rendering", () => {
    it("sollte partial gerenderte Zeichen beim Clear entfernen", async () => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={300} />);
      const output = getByTestId("serial-output");
      const { appendSerialOutput, clearSerialOutput } = useSerialIO.getState();

      act(() => {
        appendSerialOutput("Hello World");
      });

      // 5 Zeichen rendern
      act(() => {
        vi.advanceTimersByTime(165); // 5 × 33ms
      });
      await waitFor(() => expect(output.textContent).toBe("Hello"));

      // Clear
      clearSerialOutput();
      expect(output.textContent).toBe("");
    });
  });

  describe("T-BAUD-RENDER-08: Sehr lange Nachrichten", () => {
    it("sollte auch bei 1000+ Zeichen smooth rendern ohne UI zu blocken", async () => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={9600} />);
      const output = getByTestId("serial-output");
      const longMessage = "X".repeat(1000);

      act(() => {
        getByTestId("append-btn").click(); // Simuliert Append
        useSerialIO.getState().appendSerialOutput(longMessage);
      });

      // Nach 50ms: Erste ~50 Zeichen sichtbar (50 × 1ms)
      act(() => {
        vi.advanceTimersByTime(50);
      });
      const partialLength = output.textContent?.length || 0;
      expect(partialLength).toBeGreaterThan(40);
      expect(partialLength).toBeLessThan(60);

      // Nach 1050ms: Alle Zeichen sichtbar
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      await waitFor(() => expect(output.textContent?.length).toBe(1000));
    });
  });

  describe("T-BAUD-RENDER-09: Realistische Baudrate-Werte", () => {
    it.each([
      { baud: 300, msPerChar: 33.3, charsIn100ms: 3 },
      { baud: 1200, msPerChar: 8.3, charsIn100ms: 12 },
      { baud: 2400, msPerChar: 4.2, charsIn100ms: 24 },
      { baud: 4800, msPerChar: 2.1, charsIn100ms: 48 },
      { baud: 9600, msPerChar: 1.0, charsIn100ms: 96 },
      { baud: 19200, msPerChar: 0.5, charsIn100ms: 192 },
      { baud: 38400, msPerChar: 0.26, charsIn100ms: 384 },
      { baud: 57600, msPerChar: 0.17, charsIn100ms: 576 },
      { baud: 115200, msPerChar: 0.09, charsIn100ms: 1152 },
    ])("sollte bei $baud Baud ~$charsIn100ms Zeichen in 100ms rendern", async ({ baud, charsIn100ms }) => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={baud} />);
      const output = getByTestId("serial-output");
      const message = "X".repeat(charsIn100ms * 2); // 2× expected für Toleranz

      act(() => {
        useSerialIO.getState().appendSerialOutput(message);
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      const renderedLength = output.textContent?.length || 0;
      // Toleranz: ±20% von erwarteten Zeichen
      expect(renderedLength).toBeGreaterThanOrEqual(charsIn100ms * 0.8);
      expect(renderedLength).toBeLessThanOrEqual(charsIn100ms * 1.2);
    });
  });

  describe("T-BAUD-RENDER-10: No Baudrate (undefined)", () => {
    it("sollte bei nicht-definierter Baudrate sofort alle Zeichen rendern", async () => {
      const { getByTestId } = render(<TestSerialMonitor baudrate={undefined} />);
      const output = getByTestId("serial-output");

      act(() => {
        useSerialIO.getState().appendSerialOutput("Immediate render");
      });

      // Sollte sofort da sein (kein Delay)
      expect(output.textContent).toBe("Immediate render");
    });
  });
});
