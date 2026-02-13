# Baudrate-Based Character Rendering – Konzept & Umsetzungsplan

## Ziel

**Problem:** Serial Monitor zeigt alle eingehenden Zeichen sofort an, sobald ein WebSocket-Telegramm eintrifft. Dies entspricht nicht dem realen Verhalten eines Arduino Serial Monitors, wo Zeichen mit der konfigurierten Baudrate einzeln ankommen.

**Lösung:** Implementiere ein Client-seitiges Character-Streaming-System, das Zeichen mit baudrate-basierter Verzögerung progressiv rendert.

---

## Anforderungen

### Funktionale Anforderungen

| ID | Beschreibung |
|---|---|
| **F-01** | Zeichen werden einzeln mit baudrate-ba

sierter Verzögerung im Serial Monitor angezeigt |
| **F-02** | Baudrate-Änderung während des Renderings passt die Geschwindigkeit dynamisch an |
| **F-03** | Pause/Resume-Funktionalität stoppt/startet das Character-Rendering |
| **F-04** | Clear entfernt alle Zeichen inkl. pending Render-Queue |
| **F-05** | Mehrere eingehende Chunks werden sequenziell abgearbeitet |
| **F-06** | Bei undefined Baudrate erfolgt sofortiges Rendering (Fallback) |
| **F-07** | Sehr hohe Baudraten (≥115200) rendern quasi-sofort (≤ 1ms/char) |
| **F-08** | Sehr niedrige Baudraten (≤300) zeigen deutlich sichtbare Verzögerung (≥10ms/char) |

### Non-Funktionale Anforderungen

| ID | Beschreibung |
|---|---|
| **NF-01** | UI bleibt während Character-Rendering reaktiv (kein Blocking) |
| **NF-02** | Memory-Overhead < 1 MB selbst bei 100k+ Zeichen in Queue |
| **NF-03** | Smooth Rendering auch bei 1000+ Zeichen langen Nachrichten |
| **NF-04** | Performance: Max 5% CPU-Last bei aktivem Rendering |

---

## Architektur-Überblick

### Komponenten

```
┌─────────────────────────────────────────────────────────────┐
│                   WebSocket Manager                         │
│  (empfängt serial_output Messages vom Backend)              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              SerialCharacterRenderer                        │
│  • Verwaltet Character-Queue                                │
│  • Tick-basiertes Rendering (requestAnimationFrame)         │
│  • Baudrate-to-delay Berechnung                            │
│  • Pause/Resume/Clear/BaudrateChange API                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│               useSerialIO Hook                              │
│  • Konsumiert SerialCharacterRenderer                       │
│  • State: visibleOutput (progressiv wachsend)               │
│  • Expose: appendSerialOutput, setBaudrate, pause, etc.     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│            Serial Monitor UI Component                      │
│  • Rendert visibleOutput                                    │
│  • Zeigt "Receiving..." Indicator während Streaming         │
└─────────────────────────────────────────────────────────────┘
```

---

## Technisches Design

### 1. SerialCharacterRenderer Class

**Verantwortlichkeiten:**
- Character-Queue verwalten
- Baudrate-basierte Delays berechnen
- requestAnimationFrame-basiertes Tick-System
- State: paused, currentBaudrate, lastRenderTime

```typescript
class SerialCharacterRenderer {
  private queue: string = "";
  private paused: boolean = false;
  private baudrate: number | undefined;
  private lastCharTime: number = 0;
  private rafId: number | null = null;
  private onChar: (char: string) => void;

  constructor(onChar: (char: string) => void) {
    this.onChar = onChar;
  }

  enqueue(data: string): void {
    this.queue += data;
    if (!this.rafId && !this.paused) {
      this.start();
    }
  }

  setBaudrate(baud: number | undefined): void {
    this.baudrate = baud;
  }

  pause(): void {
    this.paused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(): void {
    this.paused = false;
    if (this.queue.length > 0) {
      this.start();
    }
  }

  clear(): void {
    this.queue = "";
    this.pause();
  }

  private start(): void {
    if (this.rafId) return;
    this.lastCharTime = performance.now();
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (this.paused || this.queue.length === 0) {
      this.rafId = null;
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastCharTime;

    const msPerChar = this.calculateMsPerChar();

    if (elapsed >= msPerChar) {
      // Render 1 character
      const char = this.queue[0];
      this.queue = this.queue.slice(1);
      this.onChar(char);
      this.lastCharTime = now;
    }

    if (this.queue.length > 0) {
      this.rafId = requestAnimationFrame(() => this.tick());
    } else {
      this.rafId = null;
    }
  }

  private calculateMsPerChar(): number {
    if (!this.baudrate) {
      return 0; // Immediate rendering
    }

    // Baud = bits/second
    // Bytes/second = Baud / 10 (1 start bit + 8 data bits + 1 stop bit)
    const bytesPerSecond = this.baudrate / 10;
    const secondsPerByte = 1 / bytesPerSecond;
    const msPerByte = secondsPerByte * 1000;

    // Minimum 0.1ms to avoid blocking at very high bauds
    return Math.max(0.1, msPerByte);
  }

  destroy(): void {
    this.clear();
  }
}
```

### 2. useSerialIO Hook Integration

```typescript
export function useSerialIO() {
  const [visibleOutput, setVisibleOutput] = useState("");
  const rendererRef = useRef<SerialCharacterRenderer | null>(null);

  useEffect(() => {
    const renderer = new SerialCharacterRenderer((char) => {
      setVisibleOutput((prev) => prev + char);
    });
    rendererRef.current = renderer;

    return () => renderer.destroy();
  }, []);

  const appendSerialOutput = useCallback((data: string) => {
    rendererRef.current?.enqueue(data);
  }, []);

  const setBaudrate = useCallback((baud: number | undefined) => {
    rendererRef.current?.setBaudrate(baud);
  }, []);

  const pauseRendering = useCallback(() => {
    rendererRef.current?.pause();
  }, []);

  const resumeRendering = useCallback(() => {
    rendererRef.current?.resume();
  }, []);

  const clearSerialOutput = useCallback(() => {
    rendererRef.current?.clear();
    setVisibleOutput("");
  }, []);

  return {
    serialOutput: visibleOutput,
    appendSerialOutput,
    setBaudrate,
    pauseRendering,
    resumeRendering,
    clearSerialOutput,
  };
}
```

### 3. UI Feedback

**Streaming-Indicator:**
```tsx
{isStreaming && (
  <div className="text-xs text-cyan-400 animate-pulse">
    ▶ Receiving... ({queueLength} chars pending)
  </div>
)}
```

---

## Baudrate-Delay Tabelle

| Baudrate | Bytes/s | ms/Zeichen | Sichtbar? |
|---|---|---|---|
| 300 | 30 | 33.3 | ✅ Deutlich langsam |
| 1200 | 120 | 8.3 | ✅ Sichtbar verzögert |
| 2400 | 240 | 4.2 | ✅ Leicht verzögert |
| 9600 | 960 | 1.0 | 🟡 Subtil |
| 19200 | 1920 | 0.5 | 🟡 Kaum merklich |
| 57600 | 5760 | 0.17 | ⚪ Quasi instant |
| 115200 | 11520 | 0.09 | ⚪ Instant |

---

## Performance-Optimierungen

### 1. Batching bei hohen Baudraten
```typescript
private tick(): void {
  const msPerChar = this.calculateMsPerChar();
  
  // Bei < 1ms/char: Batch-Rendering (mehrere chars pro Tick)
  if (msPerChar < 1) {
    const charsToRender = Math.floor(1 / msPerChar);
    const batch = this.queue.slice(0, charsToRender);
    this.queue = this.queue.slice(charsToRender);
    this.onChar(batch); // Batch als String
  } else {
    // Standard: 1 char pro Tick
    // ...
  }
}
```

### 2. Adaptive Tick-Rate
```typescript
// Bei langen Queues: Höhere Render-Frequenz
const targetFPS = this.queue.length > 1000 ? 120 : 60;
```

### 3. Memory-Limit für Queue
```typescript
private static MAX_QUEUE_SIZE = 50000; // ~50KB

enqueue(data: string): void {
  if (this.queue.length + data.length > SerialCharacterRenderer.MAX_QUEUE_SIZE) {
    // Drop oldest chars
    const overflow = (this.queue.length + data.length) - SerialCharacterRenderer.MAX_QUEUE_SIZE;
    this.queue = this.queue.slice(overflow);
  }
  this.queue += data;
}
```

---

## Phasenplan (Commit-Ready)

### **Phase 1: Core Renderer Implementation** 
**Ziel:** SerialCharacterRenderer Klasse mit Basic Funktionalität

**Tasks:**
- [ ] Erstelle `src/utils/serial-character-renderer.ts`
- [ ] Implementiere Queue-Management (enqueue/clear)
- [ ] Implementiere Baudrate-to-Delay Berechnung
- [ ] Implementiere RAF-basiertes Tick-System
- [ ] Implementiere Pause/Resume
- [ ] Unit-Tests für Renderer

**Acceptance Criteria:**
- Tests T-BAUD-RENDER-01 bis T-BAUD-RENDER-03 bestehen
- Standalone-Renderer funktioniert isoliert

---

### **Phase 2: useSerialIO Hook Integration**
**Ziel:** Integration des Renderers in bestehenden Hook

**Tasks:**
- [ ] Erweitere `useSerialIO` Hook um Renderer
- [ ] Refactor: `appendSerialOutput` nutzt `renderer.enqueue()`
- [ ] Expose `pauseRendering`/`resumeRendering` APIs
- [ ] Expose `setBaudrate` API
- [ ] State: `visibleOutput` ersetzt altes `serialOutput`

**Acceptance Criteria:**
- Tests T-BAUD-RENDER-04 bis T-BAUD-RENDER-06 bestehen
- Bestehende Serial Monitor UI funktioniert weiterhin

---

### **Phase 3: WebSocket Integration**
**Ziel:** Baudrate-Sync zwischen Backend und Frontend

**Tasks:**
- [ ] `io_registry` Message: Baudrate an Frontend senden
- [ ] `arduino-simulator.tsx`: Call `setBaudrate()` bei Registry-Update
- [ ] Baudrate-Änderungen während Laufzeit propagieren

**Acceptance Criteria:**
- Test T-BAUD-RENDER-05 besteht
- Baudrate aus Sketch wird korrekt übernommen

---

### **Phase 4: UI Feedback & Polish**
**Ziel:** Visuelle Indikatoren für aktives Streaming

**Tasks:**
- [ ] "Receiving..." Indicator wenn Queue > 0
- [ ] Queue-Length Anzeige (opt-in Debug-Mode)
- [ ] Smooth Scroll während Rendering
- [ ] CSS: Cursor-Blink für letztes Zeichen

**Acceptance Criteria:**
- Test T-BAUD-RENDER-08 besteht
- UX fühlt sich smooth an bei langen Nachrichten

---

### **Phase 5: Performance Optimizations**
**Ziel:** Batch-Rendering für hohe Baudraten, Memory-Limits

**Tasks:**
- [ ] Implementiere Batching bei < 1ms/char
- [ ] Implementiere Queue-Size-Limit (50KB)
- [ ] Adaptive Tick-Rate basierend auf Queue-Length
- [ ] Performance-Tests

**Acceptance Criteria:**
- Test T-BAUD-RENDER-09 besteht (alle Baudraten)
- CPU-Last < 5% während Rendering
- Keine Memory-Leaks bei 100k+ Zeichen

---

### **Phase 6: Edge Cases & Robustness**
**Ziel:** Clear, Undefined Baudrate, Multi-Chunk Handling

**Tasks:**
- [ ] Clear während Rendering unterbricht korrekt
- [ ] Undefined Baudrate → sofortiges Rendering
- [ ] Multiple Chunks queuen korrekt hintereinander
- [ ] Stress-Tests (10MB Output, schnelle Pause/Resume Cycles)

**Acceptance Criteria:**
- Test T-BAUD-RENDER-07, T-BAUD-RENDER-10 bestehen
- Alle Edge-Case-Tests grün

---

### **Phase 7: E2E Tests & Documentation**
**Ziel:** End-to-End-Validierung mit echtem Arduino-Code

**Tasks:**
- [ ] E2E-Test: Flood-Sketch mit 300 Baud → sichtbare Verzögerung
- [ ] E2E-Test: Baudrate-Wechsel während Laufzeit
- [ ] Update Dokumentation (README, SSOT)
- [ ] Changelog-Eintrag

**Acceptance Criteria:**
- Alle E2E-Tests bestehen
- `./run-tests.sh` grün
- Dokumentation vollständig

---

## Test-Strategie

### Unit-Tests
- `serial-character-renderer.test.ts`: Isolated Renderer Logic
- `use-serial-io.test.tsx`: Hook Integration

### Integration-Tests
- `serial-monitor-baudrate-rendering.test.tsx`: UI + Hook + Renderer

### E2E-Tests
- `e2e/serial-baudrate-rendering.spec.ts`: Echtes Arduino-Programm

---

## Risiken & Mitigation

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| Performance-Issues bei hohen Baudraten | Mittel | Hoch | Batch-Rendering implementieren |
| Memory-Leaks bei langen Queues | Mittel | Hoch | Queue-Size-Limit + Monitoring |
| RAF funktioniert nicht in Tests | Hoch | Mittel | Mock RAF in Vitest Setup |
| Bestehende Tests brechen | Mittel | Hoch | Schrittweise Integration, Feature-Flag |

---

## Offene Fragen

1. **Feature-Flag?** Soll Baudrate-Rendering optional sein (Settings-Toggle)?
2. **Auto-Scroll-Verhalten?** Soll während Streaming immer zum Ende gescrollt werden?
3. **Visual Feedback?** Cursor-Blink am Ende, "Typing"-Animation?
4. **Backend-Drops sichtbar?** Soll gedropter Content visuell markiert werden?

---

## Erfolgsmetriken

- ✅ Alle 10 Testfälle bestehen
- ✅ CPU-Last < 5% während aktiven Renderings
- ✅ Smooth UX bei allen Baudraten (300 – 115200)
- ✅ Keine Regression in bestehenden Serial Monitor Tests
- ✅ E2E-Tests validieren End-User-Experience
