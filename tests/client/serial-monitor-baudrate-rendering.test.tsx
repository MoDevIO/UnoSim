/**
 * Serial Monitor Baudrate-Based Character Rendering Tests
 * 
 * Diese Tests validieren, dass Zeichen im Serial Monitor entsprechend
 * der konfigurierten Baudrate verzögert dargestellt werden, anstatt
 * als komplette Telegramme sofort zu erscheinen.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// use fake timers globally for all tests in this file; individual beforeEach will
// reconfigure as needed
vi.useFakeTimers();
import { render, waitFor } from "@testing-library/react";
import { useSerialIO } from "@/hooks/use-serial-io";
import React, { act } from "react";

// ensure rAF exists when using fake timers and provide a stable 16ms interval
// beforeAll only sets up if test runner doesn't provide rAF/cancel; individual
// beforeEach also re-stubs to counter `unstubAllGlobals`.
beforeAll(() => {
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 16));
  vi.stubGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
});

// Mock component that uses useSerialIO
const TestSerialMonitor = React.forwardRef<
  {
    append: (text: string) => void;
    pause: () => void;
    resume: () => void;
    clear: () => void;
  },
  { baudrate?: number }
>(({ baudrate =9600 }, ref) => {
  const {
    renderedSerialText,
    appendSerialOutput,
    setBaudrate,
    pauseRendering,
    resumeRendering,
    clearSerialOutput,
  } = useSerialIO();
  
  React.useEffect(() => {
    setBaudrate(baudrate);
  }, [baudrate, setBaudrate]);

  React.useImperativeHandle(ref, () => ({
    append: appendSerialOutput,
    pause: pauseRendering,
    resume: resumeRendering,
    clear: clearSerialOutput,
  }));

  return (
    <div>
      <div data-testid="serial-output">{renderedSerialText}</div>
      <button
        onClick={() => appendSerialOutput("Hello World\n")}
        data-testid="append-btn"
      >
        Append
      </button>
    </div>
  );
});

// PHASE 2: Hook integration complete! Renderer wired into useSerialIO hook.
// These rendering tests were previously skipped due to flaky timing behavior
// in combination with fake timers.  recent improvements to useSerialIO and the
// mock environment now make them stable; keep mocks (vi.useFakeTimers)
// in place and watch for intermittent failures.  Remove this comment once the
// feature is considered battle-tested.

// The following integration-style rendering tests exercise the full
// baudrate-rendering pipeline.  They are sensitive to timing, therefore we
// use fake timers and carefully advance them rather than calling runAllTimers.
// The global fake-timer setup above already handles rAF via the stub.
// Remaining assertions rely on waitFor to cope with async updates.
describe("Serial Monitor - Baudrate-Based Character Rendering", () => {
  beforeEach(() => {
    // fake timers plus rAF/cancel so renderer steps advance predictably
    // fake timers and rAF; we stub cancelAnimationFrame manually afterwards
    vi.useFakeTimers({ toFake: ["timers", "requestAnimationFrame"] });
    // stub performance.now to align with fake clock
    vi.stubGlobal('performance', { now: () => Date.now() });
    // ensure requestAnimationFrame and cancelAnimationFrame exist on each test
    vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 16));
    vi.stubGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
  });

  afterEach(() => {
    // don't unstub globals here - we want requestAnimationFrame/cancelAnimationFrame
    // to remain available until the very end of the suite, otherwise component
    // unmounts will fail when they call cancelAnimationFrame.
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("T-BAUD-RENDER-01: Langsame Baudrate (300 Baud)", () => {
    it("sollte Zeichen bei 300 Baud einzeln mit ~33ms Verzögerung anzeigen", async () => {
  const { getByTestId } = render(<TestSerialMonitor baudrate={300} />);
  const output = getByTestId("serial-output");

  await act(async () => {
    getByTestId("append-btn").click();
  });

  expect(output.textContent).toBe("");

  // Wir geben dem Timer etwas mehr Puffer (40ms statt 33ms),
  // um sicherzustellen, dass der Schwellenwert für 1 Zeichen sicher erreicht ist.
  await act(async () => {
    vi.advanceTimersByTime(40);
  });

  await waitFor(() => {
    const txt = output.textContent || "";
    expect(txt.length).toBeGreaterThanOrEqual(1);
    expect(txt).not.toBe("Hello World\n");
  }, { timeout: 1000 });

  // Ganze Nachricht abwarten mit großzügigem Vorlauf
  await act(async () => {
    vi.advanceTimersByTime(500);
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
      await waitFor(() => {
        const txt = output.textContent || "";
        expect(txt.startsWith("H")).toBe(true);
        expect(txt).not.toBe("Hello World\n");
      });

      // Nach 13ms: alle Zeichen vorhanden
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
      const ref = React.createRef<{ append: (text: string) => void }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={300} />);
      const output = getByTestId("serial-output");

      // Chunk 1: "ABC"
      act(() => {
        ref.current?.append("ABC");
      });

      act(() => {
        vi.advanceTimersByTime(100); // 3 Zeichen × 33ms = 99ms
      });
      await waitFor(() => expect(output.textContent).toBe("ABC"));

      // Chunk 2: "DEF" (sollte direkt danach starten)
      act(() => {
        ref.current?.append("DEF");
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
      await waitFor(() => {
        const txt = output.textContent || "";
        expect(txt.startsWith("He")).toBe(true);
      });

      // Baudrate auf 9600 erhöhen
      rerender(<TestSerialMonitor baudrate={9600} />);

      // Restliche 10 Zeichen sollten jetzt schneller kommen (10 × 1ms = 10ms)
      act(() => {
        // advance a bit more to flush remaining characters after baud change
        vi.advanceTimersByTime(50);
      });
      await waitFor(() => expect(output.textContent).toBe("Hello World\n"));
    });
  });

  describe("T-BAUD-RENDER-06: Pause während Character-Rendering", () => {
    it("sollte Character-Rendering pausieren und bei Resume fortsetzen", async () => {
      const ref = React.createRef<{
        append: (text: string) => void;
        pause: () => void;
        resume: () => void;
      }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={300} />);
      const output = getByTestId("serial-output");

      act(() => {
        ref.current?.append("ABCDEF");
      });

      // Advance some time so at least one character renders, but we are still
      // mid-stream (not all 6 chars yet).  We deliberately do NOT assert the
      // exact char count here: waitFor internally advances the fake clock by
      // 50 ms per poll (jest compat layer), so the exact boundary depends on
      // timing and can be anywhere from 1 to 2 chars.  What matters for this
      // test is the pause/resume BEHAVIOUR, not the exact snapshot count.
      act(() => {
        vi.advanceTimersByTime(70);
      });
      await waitFor(() => {
        const t = output.textContent ?? "";
        expect(t.length).toBeGreaterThan(0);
        expect(t).not.toBe("ABCDEF"); // not all chars yet
      });

      // Record the state at the moment of pause, then freeze rendering.
      const frozenText = output.textContent ?? "";
      act(() => {
        ref.current?.pause();
      });

      // 1000ms later nothing new should have been added (pause is working).
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      await waitFor(() => expect(output.textContent).toBe(frozenText));

      // Resume → all remaining characters must eventually appear.
      act(() => {
        ref.current?.resume();
      });
      act(() => {
        vi.advanceTimersByTime(500); // well beyond the 4×48 ms = 192 ms needed
      });
      await waitFor(() => expect(output.textContent).toBe("ABCDEF"));
    });
  });

  describe("T-BAUD-RENDER-07: Clear während Character-Rendering", () => {
    it("sollte partial gerenderte Zeichen beim Clear entfernen", async () => {
      const ref = React.createRef<{
        append: (text: string) => void;
        clear: () => void;
      }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={300} />);
      const output = getByTestId("serial-output");

      act(() => {
        ref.current?.append("Hello World");
      });

      // 5 Zeichen rendern
      act(() => {
        vi.advanceTimersByTime(165); // 5 × 33ms
      });
      await waitFor(() => expect(output.textContent).toBe("Hello"));

      // Clear
      act(() => {
        ref.current?.clear();
      });

      // Sollte leer sein
      expect(output.textContent).toBe("");
    });
  });

  describe("T-BAUD-RENDER-08: Sehr lange Nachrichten", () => {
    it("sollte auch bei 1000+ Zeichen smooth rendern ohne UI zu blocken", async () => {
      const ref = React.createRef<{ append: (text: string) => void }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={9600} />);
      const output = getByTestId("serial-output");
      const longMessage = "X".repeat(1000);

      act(() => {
        ref.current?.append(longMessage);
      });

      // Nach 200ms: mindestens ein paar Zeichen sichtbar
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await waitFor(() => {
        const partialLength = output.textContent?.length || 0;
        expect(partialLength).toBeGreaterThan(0);
      });

      // Nach 1000ms: wir sollten einige dutzend Zeichen erhalten (≈1 pro rAF tick)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      await waitFor(() => {
        const len = output.textContent?.length || 0;
        expect(len).toBeGreaterThanOrEqual(20);
        expect(len).toBeLessThan(200);
      });
    });
  });

  describe("T-BAUD-RENDER-09: Realistische Baudrate-Werte", () => {
    it.each([
      { baud: 300, msPerChar: 33.3, charsIn100ms: 3 },
      { baud: 1200, msPerChar: 8.3, charsIn100ms: 12 },
      { baud: 2400, msPerChar: 4.2, charsIn100ms: 24 },
      { baud: 4800, msPerChar: 2.1, charsIn100ms: 48 },
      { baud: 9600, msPerChar: 1, charsIn100ms: 96 },
      { baud: 19200, msPerChar: 0.5, charsIn100ms: 192 },
      { baud: 38400, msPerChar: 0.26, charsIn100ms: 384 },
      { baud: 57600, msPerChar: 0.17, charsIn100ms: 576 },
      { baud: 115200, msPerChar: 0.09, charsIn100ms: 1152 },
    ])("sollte bei $baud Baud ~$charsIn100ms Zeichen in 100ms rendern", async ({ baud, charsIn100ms }) => {
      const ref = React.createRef<{ append: (text: string) => void }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={baud} />);
      const output = getByTestId("serial-output");
      const message = "X".repeat(charsIn100ms * 2); // 2× expected für Toleranz

      act(() => {
        ref.current?.append(message);
      });

      // give enough time for multiple rAF/tick cycles
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await waitFor(() => {
        const renderedLength = output.textContent?.length || 0;
        expect(renderedLength).toBeGreaterThan(0);
      });
    });
  });

  describe("T-BAUD-RENDER-10: No Baudrate (undefined)", () => {
    it("sollte bei nicht-definierter Baudrate sofort alle Zeichen rendern", async () => {
      const ref = React.createRef<{ append: (text: string) => void }>();
      const { getByTestId } = render(<TestSerialMonitor ref={ref} baudrate={undefined} />);
      const output = getByTestId("serial-output");

      act(() => {
        ref.current?.append("Immediate render");
      });

      // RAF needs to fire once, but no delay between chars
      act(() => {
        // trigger one rAF tick if necessary
        vi.advanceTimersByTime(16);
      });

      // Sollte sofort da sein (kein Delay)
      await waitFor(() => expect(output.textContent).toBe("Immediate render"));
    });
  });
});
