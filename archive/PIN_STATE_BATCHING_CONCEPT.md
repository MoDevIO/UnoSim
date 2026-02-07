# Pin State Batching Concept

## 1. Problem-Analyse

### 1.1 Aktueller Zustand (IST)

```
┌──────────────┐    stderr     ┌──────────────────┐   1 WS msg/change   ┌────────────┐
│ C++ Simulator │ ──────────► │ SandboxRunner     │ ──────────────────► │ Browser    │
│              │  ~2000/sec   │ handleParsedLine()│    ~2000 msg/sec    │            │
│ 20 pins      │              │                   │                     │ rAF batch  │
│ delay(10)    │              │ onPinState(pin,   │                     │ ~60fps     │
│              │              │   type, value)    │                     │            │
└──────────────┘              └──────────────────┘                     └────────────┘
```

**Problem:** Jede einzelne `digitalWrite()`-Nachricht erzeugt eine eigene WebSocket-Message.
Bei 20 Pins × ~100 loops/sec = **~2000 WebSocket-Messages pro Sekunde**.

### 1.2 Wo liegt der Bottleneck?

| Stufe | Frequenz | Problem? |
|-------|----------|----------|
| C++ Simulator → stderr | ~2000/sec | ❌ OK |
| SandboxRunner Parser | ~2000/sec | ❌ OK |
| **WebSocket-Versand** | **~2000 msg/sec** | **✅ BOTTLENECK** |
| Client rAF-Batching | ~60fps | ❌ OK (dedupliziert) |
| React Re-Render | ~60fps | ❌ OK |

**Kern-Problem:** Der Server sendet **jede Pin-Änderung als einzelne WebSocket-Message**.
- JSON.stringify() × 2000/sec
- WebSocket frame overhead × 2000/sec
- Client JSON.parse() × 2000/sec
- Event-Handler-Overhead × 2000/sec

### 1.3 Was passiert nach "Stop"?

Der WebSocket-Sendepuffer ist voll mit hunderten gepufferten Nachrichten.
Auch nach Stop-Klick werden diese noch zugestellt → Frontend reagiert verzögert.

### 1.4 Client-seitiges Batching reicht nicht

Das Client-seitige `requestAnimationFrame`-Batching in `use-simulation-store.ts` dedupliziert
zwar events per `pin:stateType`, aber bei 2000 eingehenden WebSocket-Messages pro Sekunde
wird der Browser trotzdem mit JSON-Parsing und Event-Handling überlastet.

---

## 2. Lösung: Server-seitiges Pin-State Batching

### 2.1 Architektur-Ziel (SOLL)

```
┌──────────────┐    stderr     ┌──────────────────┐                     ┌────────────┐
│ C++ Simulator │ ──────────► │ SandboxRunner     │                     │ Browser    │
│              │  ~2000/sec   │ handleParsedLine()│                     │            │
│ 20 pins      │              │                   │                     │            │
│ delay(10)    │              │     │              │                     │            │
└──────────────┘              │     ▼              │                     │            │
                              │ PinStateBatcher    │  1 WS msg/tick     │            │
                              │ ┌────────────────┐ │ ─────────────────► │ Apply      │
                              │ │ Tick: 50ms     │ │  ~20 msg/sec       │ batch      │
                              │ │ Max 20 ch/pin  │ │  (max ~40 msg/sec) │ to state   │
                              │ │ Batch & send   │ │                     │            │
                              │ └────────────────┘ │                     │            │
                              └──────────────────┘                     └────────────┘
```

### 2.2 Konzept-Details

#### Tick-Interval: 50ms (= 20 Batches/sec)

- **Warum 50ms?** Menschliche Wahrnehmung: ~20fps für flüssige LED-Animation reicht
- Pro Tick: Alle gesammelten Pin-Änderungen als **ein einziges** WebSocket-Batch senden
- Max **20 msg/sec** statt bisheriger 2000 msg/sec = **100× Reduktion**

#### Sampling pro Pin: Letzter Wert gewinnt

Bei 2000 Änderungen in 50ms für 20 Pins:
- Pro Pin kommen ~5 Änderungen in 50ms
- **Nur der letzte Wert** pro Pin wird ins Batch aufgenommen
- Batch enthält: `{ pin, stateType, value }` für jeden geänderten Pin

#### Warum "letzter Wert gewinnt" richtig ist

Bei `delay(10)` mit Toggle:
- Pin 13 wechselt: HIGH → LOW → HIGH → LOW → HIGH in 50ms
- Der letzte Zustand ist der einzig relevante für die GUI-Darstellung
- Zwischenzustände sind sowieso nicht sichtbar (< 1 Frame)

### 2.3 WebSocket-Message Format

**Bisherig (pro Änderung):**
```json
{ "type": "pin_state", "pin": 13, "stateType": "value", "value": 1 }
```

**Neu (Batch pro Tick):**
```json
{
  "type": "pin_state_batch",
  "states": [
    { "pin": 0, "stateType": "value", "value": 1 },
    { "pin": 1, "stateType": "value", "value": 0 },
    { "pin": 13, "stateType": "value", "value": 1 }
  ],
  "timestamp": 1707314603417
}
```

### 2.4 Telemetrie-Integration

Der `PinStateBatcher` liefert die Telemetrie-Zahlen direkt:

| Metrik | Quelle | Bedeutung |
|--------|--------|-----------|
| `intendedPinChangesPerSecond` | Alle eingehenden Events gezählt | Was der Simulator versuchte |
| `actualPinChangesPerSecond` | Gesendete States pro Batch | Was tatsächlich gesendet wurde |
| `pinChangeLossPercentage` | `(intended - actual) / intended × 100` | Datenverlust durch Sampling |

---

## 3. Klassen-Design

### 3.1 PinStateBatcher (neue Klasse)

```typescript
// server/services/pin-state-batcher.ts

interface PinStateEvent {
  pin: number;
  stateType: "mode" | "value" | "pwm";
  value: number;
}

interface PinStateBatch {
  states: PinStateEvent[];
  timestamp: number;
}

interface PinStateBatcherConfig {
  tickIntervalMs?: number;         // Default: 50ms (= 20 batches/sec)
  onBatch: (batch: PinStateBatch) => void;
}

class PinStateBatcher {
  private pendingStates = new Map<string, PinStateEvent>();  // key: "pin:stateType"
  private tickTimer: NodeJS.Timeout | null = null;
  private intendedCount = 0;
  private actualCount = 0;
  
  constructor(config: PinStateBatcherConfig) { ... }
  
  /** Called for every pin state change from the simulator */
  enqueue(pin: number, stateType: "mode"|"value"|"pwm", value: number): void {
    const key = `${pin}:${stateType}`;
    this.pendingStates.set(key, { pin, stateType, value });
    this.intendedCount++;
  }
  
  /** Start the tick timer */
  start(): void { ... }
  
  /** Stop the tick timer, flush remaining */
  stop(): void { ... }
  
  /** Pause (stop ticking, keep state) */
  pause(): void { ... }
  
  /** Resume (restart ticking) */
  resume(): void { ... }
  
  /** Get telemetry counters and reset */
  getTelemetryAndReset(): { intended: number; actual: number } { ... }
  
  /** Destroy and clean up */
  destroy(): void { ... }
  
  // Private: called every tickIntervalMs
  private tick(): void {
    if (this.pendingStates.size === 0) return;
    
    const states = Array.from(this.pendingStates.values());
    this.pendingStates.clear();
    this.actualCount += states.length;
    
    this.config.onBatch({
      states,
      timestamp: Date.now(),
    });
  }
}
```

### 3.2 Integration in SandboxRunner

```typescript
// In handleParsedLine():
case "pin_value":
  this.pinStateBatcher.enqueue(parsed.pin, "value", parsed.value);
  break;

case "pin_pwm":
  this.pinStateBatcher.enqueue(parsed.pin, "pwm", parsed.value);
  break;

case "pin_mode":
  this.pinStateBatcher.enqueue(parsed.pin, "mode", parsed.mode);
  // PLUS: registryManager.updatePinMode() bleibt für Struktur
  break;
```

### 3.3 Integration in routes.ts

```typescript
// Statt individueller onPinState callback:
// Die PinStateBatcher.onBatch callback sendet:
(batch: PinStateBatch) => {
  sendMessageToClient(ws, {
    type: "pin_state_batch",
    states: batch.states,
    timestamp: batch.timestamp,
  });
}
```

### 3.4 Integration im Client

```typescript
// In arduino-simulator.tsx:
case "pin_state_batch": {
  const { states } = message;
  for (const { pin, stateType, value } of states) {
    enqueuePinEvent(pin, stateType, value);
  }
  break;
}

// ODER besser: Neuer Bulk-Import direkt:
case "pin_state_batch": {
  enqueuePinEventBatch(message.states);
  break;
}
```

In `use-simulation-store.ts`:
```typescript
const enqueuePinEventBatch = (events: PinEvent[]) => {
  for (const { pin, stateType, value } of events) {
    const key = `${pin}:${stateType}`;
    pendingEvents.set(key, { pin, stateType, value });
  }
  scheduleFlush();
};
```

---

## 4. Telemetrie-Rückbau

### 4.1 Was wird entfernt

Die aktuelle separate Telemetrie-Tracking-Logik in `RegistryManager` wird vereinfacht:

| Entfernen | Datei | Grund |
|-----------|-------|-------|
| `trackIntendedPinChange()` | registry-manager.ts | → Zählung wandert in PinStateBatcher |
| `this.telemetry.intendedPinChanges` | registry-manager.ts | → PinStateBatcher.intendedCount |
| `this.telemetry.pinChanges` | registry-manager.ts | → PinStateBatcher.actualCount |
| `this.lastPinChangeTime` Map | registry-manager.ts | → Nicht mehr nötig (Batcher ersetzt Debounce) |
| 50ms Debounce in `updatePinValue()` | registry-manager.ts | → Batcher-Tick ersetzt dies |
| 50ms Debounce in `updatePinPWM()` | registry-manager.ts | → Batcher-Tick ersetzt dies |
| `trackIntendedPinChange()` Aufrufe | sandbox-runner.ts | → PinStateBatcher.enqueue() ersetzt dies |

### 4.2 Was bleibt im RegistryManager

| Behalten | Grund |
|----------|-------|
| `updatePinMode()` | Strukturelle Pin-Änderungen (pin defined: true) |
| `updatePinValue()` | Nur noch für `incomingEvents`-Zählung (ohne Debounce) |
| `updatePinPWM()` | Nur noch für `incomingEvents`-Zählung (ohne Debounce) |
| `getPerformanceMetrics()` | Bezieht intended/actual aus PinStateBatcher |
| `startHeartbeat()` / `stopTelemetry()` | Telemetrie-Intervall bleibt 1s |

### 4.3 Was unverändert bleibt

| Unverändert | Datei |
|-------------|-------|
| `io_registry` WebSocket-Nachrichten | Strukturelle Pin-Daten (unabhängig) |
| `sim_telemetry` WebSocket-Nachrichten | Format bleibt, nur Daten-Quelle ändert sich |
| Client `requestAnimationFrame` Batching | Bleibt als 2. Stufe der Deduplizierung |
| Client `PinState[]` Store | Interface ändert sich nicht |

---

## 5. Reihenfolge der Verarbeitung (komplett)

```
Schritt  Komponente                  Frequenz        Aktion
──────  ──────────                  ──────────      ──────
  1     C++ Simulator               ~2000/sec       digitalWrite(pin, val) → stderr
  2     SandboxRunner.parse         ~2000/sec       [[PIN_VALUE:pin:val]] → parsed object
  3     handleParsedLine            ~2000/sec       Dispatch:
        3a  PinStateBatcher.enqueue ~2000/sec         Sammelt in Map (letzter Wert/Pin gewinnt)
        3b  RegistryManager         ~2000/sec         updatePinValue() nur für Event-Zählung
  4     PinStateBatcher.tick        20/sec (50ms)   Sendet Batch aus Map → WebSocket
  5     WebSocket Transport         20/sec          1 Message mit allen Pin-States
  6     Client onmessage           20/sec          Empfängt pin_state_batch
  7     enqueuePinEventBatch       20/sec          Events in pendingEvents Map
  8     rAF flush                  60/sec          Wendet Events auf PinState[] an
  9     React render               60/sec          UI Update
```

**Ergebnis:** 2000 msg/sec → 20 msg/sec = **100× weniger WebSocket-Traffic**

---

## 6. Umgang mit zu schnellen Pin-Changes

### 6.1 Dein Vorschlag: "Reduzierung auf max Frequenz pro Pin"

**Antwort:** Das ist exakt was der Batcher macht!

- Tick = 50ms → Max 20 Samples/sec pro Pin
- `Map.set(key, event)` → "Last Value Wins" = automatisches Downsampling
- KEINE separate Frequenz-Begrenzung pro Pin nötig

### 6.2 Zeitliche Korrektheit

**Wird es zeitlich korrekt sein?**

- Bei ≤20Hz pro Pin (z.B. `delay(50)` oder länger): **JA, exakt korrekt**
  - Jede Änderung wird in einem eigenen 50ms-Tick erfasst
  - Volle zeitliche Auflösung

- Bei >20Hz pro Pin (z.B. `delay(10)` = 100Hz): **NEIN, aber transparent**
  - Sampling: 100 Änderungen/sec → 20 Samples/sec
  - GUI zeigt "1515 /s → 379 /s (Loss: 75%)" = User weiß Bescheid
  - Die LED blinkt trotzdem korrekt mit 20fps

### 6.3 GUI-Hinweis bei Loss

```
Wenn pinChangeLossPercentage > 0:
  "Pin Changes: 1515.0 /s → 379.2 /s (Loss: 75%)"

Tooltip/Erklärung:
  "Simulierte Pin-Änderungen überschreiten die maximal darstellbare Rate. 
   Die Visualisierung zeigt eine heruntergetaktete Version."
```

---

## 7. Test-Driven Umsetzungsplan

### Phase 1: PinStateBatcher (Unit Tests → Implementierung)

#### Test 1.1: Grundlegendes Batching
```
GIVEN PinStateBatcher mit tickInterval=50ms
WHEN  3 Pin-Events für verschiedene Pins enqueuet werden
AND   50ms vergehen (tick)
THEN  onBatch wird mit 3 Events aufgerufen
AND   pendingStates ist leer
```

#### Test 1.2: Letzter-Wert-Gewinnt (Deduplizierung)
```
GIVEN PinStateBatcher mit tickInterval=50ms
WHEN  Pin 13 value=1, dann Pin 13 value=0 enqueuet wird
AND   50ms vergehen (tick)
THEN  Batch enthält nur 1 Event: pin=13, value=0
```

#### Test 1.3: Verschiedene stateTypes nicht dedupliziert
```
GIVEN PinStateBatcher mit tickInterval=50ms
WHEN  Pin 13 stateType="value" value=1 enqueuet wird
AND   Pin 13 stateType="mode" value=1 enqueuet wird
AND   50ms vergehen (tick)
THEN  Batch enthält 2 Events (value + mode)
```

#### Test 1.4: Kein Tick bei leerer Queue
```
GIVEN PinStateBatcher läuft
WHEN  50ms vergehen ohne Events
THEN  onBatch wird NICHT aufgerufen
```

#### Test 1.5: Telemetrie-Zählung
```
GIVEN PinStateBatcher
WHEN  10 Events enqueuet werden (davon 4 Duplikate auf selben pin:stateType)
AND   tick auslöst (6 unique Events im Batch)
THEN  getTelemetryAndReset() liefert { intended: 10, actual: 6 }
AND   nach Reset: { intended: 0, actual: 0 }
```

#### Test 1.6: Pause/Resume
```
GIVEN PinStateBatcher läuft und hat pending Events
WHEN  pause() aufgerufen wird
THEN  Timer stoppt, pending Events bleiben erhalten
WHEN  resume() aufgerufen wird
THEN  Timer startet neu, nächster Tick sendet die gepufferten Events
```

#### Test 1.7: Stop flusht pending Events
```
GIVEN PinStateBatcher mit 5 pending Events
WHEN  stop() aufgerufen wird
THEN  Ein letzter Batch mit den 5 Events wird gesendet
AND   Timer ist gestoppt
```

#### Test 1.8: Destroy räumt auf
```
GIVEN PinStateBatcher läuft
WHEN  destroy() aufgerufen wird
THEN  Timer gestoppt, pending Events verworfen, keine weiteren Callbacks
```

#### Test 1.9: Multi-Pin Szenario (20 Pins)
```
GIVEN PinStateBatcher mit tickInterval=50ms
WHEN  20 Pins jeweils 5× geändert werden (100 Events total)
AND   tick auslöst
THEN  Batch enthält exakt 20 Events (1 pro Pin, letzter Wert)
AND   intended=100, actual=20
```

#### Test 1.10: Schnelle sequentielle Ticks
```
GIVEN PinStateBatcher mit tickInterval=50ms
WHEN  Tick 1: 5 Events → Batch 1
AND   Tick 2: 3 Events → Batch 2
THEN  Jeder Batch enthält nur Events seines Intervalls
AND   Keine Events gehen verloren, keine werden doppelt gesendet
```

### Phase 2: Server-Integration (Integration Tests → Implementierung)

#### Test 2.1: SandboxRunner nutzt PinStateBatcher
```
GIVEN SandboxRunner mit PinStateBatcher
WHEN  handleParsedLine() mit type="pin_value" aufgerufen wird
THEN  PinStateBatcher.enqueue() wird aufgerufen
AND   NICHT mehr direkt onPinState() callback
```

#### Test 2.2: Keine individuellen pin_state Messages mehr
```
GIVEN Laufende Simulation mit 20 Pins
WHEN  100 Pin-Changes in 1 Sekunde passieren
THEN  WebSocket sendet ≤20 Nachrichten (statt 100)
AND   Nachrichtentyp ist "pin_state_batch"
```

#### Test 2.3: RegistryManager Telemetrie bezieht Daten aus Batcher
```
GIVEN RegistryManager mit PinStateBatcher-Referenz
WHEN  getPerformanceMetrics() aufgerufen wird
THEN  intendedPinChangesPerSecond kommt aus Batcher.intended
AND   actualPinChangesPerSecond kommt aus Batcher.actual
```

#### Test 2.4: Pause/Resume Lifecycle
```
GIVEN Simulation läuft mit aktiven Pin-Changes
WHEN  Pause-Event empfangen wird
THEN  PinStateBatcher.pause() wird aufgerufen, Timer stoppt
WHEN  Resume-Event empfangen wird
THEN  PinStateBatcher.resume() wird aufgerufen, Batching startet wieder
```

#### Test 2.5: Stop flusht und räumt auf
```
GIVEN Simulation läuft mit pending Pin-Events im Batcher
WHEN  Stop gedrückt wird
THEN  PinStateBatcher.stop() sendet letzte Events
AND   Keine weiteren Nachrichten kommen nach Stop
```

### Phase 3: Schema & WebSocket (Schema Tests → Implementierung)

#### Test 3.1: pin_state_batch Schema-Validierung
```
GIVEN Zod-Schema für pin_state_batch
WHEN  { type: "pin_state_batch", states: [{pin:13,stateType:"value",value:1}], timestamp: 123 }
THEN  Schema validiert erfolgreich
```

#### Test 3.2: Altes pin_state Format bleibt abwärtskompatibel (Übergang)
```
GIVEN Client empfängt altes {type:"pin_state"} Format
THEN  Client verarbeitet korrekt (Fallback)
```

### Phase 4: Client-Integration (Integration Tests → Implementierung)

#### Test 4.1: Client verarbeitet pin_state_batch
```
GIVEN Client WebSocket handler
WHEN  pin_state_batch mit 5 Events empfangen wird
THEN  enqueuePinEventBatch() wird aufgerufen
AND   5 Events landen in pendingEvents Map
AND   scheduleFlush() wird 1× aufgerufen (nicht 5×)
```

#### Test 4.2: Client Deduplizierung funktioniert mit Batches
```
GIVEN Client
WHEN  2 aufeinanderfolgende Batches mit selben Pins kommen
AND   rAF noch nicht geflusht hat
THEN  Nur letzte Werte werden angewendet (Map-Deduplizierung)
```

#### Test 4.3: Telemetrie-Anzeige zeigt Batch-Metriken
```
GIVEN Debug-Mode aktiviert
WHEN  Telemetrie empfangen wird mit pinChangeLossPercentage > 0
THEN  GUI zeigt "1515.0 /s → 379.2 /s (Loss: 75%)"
```

### Phase 5: Rückbau (Tests → Cleanup)

#### Test 5.1: Alte pin_state Individual-Messages werden nicht mehr gesendet
```
GIVEN Simulation mit 100 Pin-Changes
WHEN  WebSocket-Traffic analysiert wird
THEN  Kein type:"pin_state" mehr (nur "pin_state_batch")
```

#### Test 5.2: RegistryManager hat keine Debounce-Logik mehr
```
GIVEN RegistryManager
WHEN  updatePinValue(13, 1) aufgerufen wird
THEN  Keine Debounce-Prüfung (kein lastPinChangeTime)
AND   telemetry.pinChanges wird NICHT mehr inkrementiert
AND   Nur telemetry.incomingEvents wird inkrementiert
```

---

## 8. Dateien-Änderungsplan

### Neue Dateien
| Datei | Beschreibung |
|-------|-------------|
| `server/services/pin-state-batcher.ts` | PinStateBatcher Klasse |
| `tests/server/services/pin-state-batcher.test.ts` | Unit Tests |
| `tests/server/services/pin-state-integration.test.ts` | Integration Tests |

### Zu ändernde Dateien
| Datei | Änderung |
|-------|---------|
| `server/services/sandbox-runner.ts` | PinStateBatcher erstellen, enqueue statt onPinState |
| `server/services/registry-manager.ts` | Debounce-Logik entfernen, Telemetrie aus Batcher beziehen |
| `server/routes.ts` | onBatch statt onPinState für WebSocket-Versand |
| `shared/schema.ts` | `pin_state_batch` Message-Typ hinzufügen |
| `client/src/pages/arduino-simulator.tsx` | `pin_state_batch` Handler hinzufügen |
| `client/src/hooks/use-simulation-store.ts` | `enqueuePinEventBatch()` Funktion hinzufügen |

### Zu entfernende Code-Teile
| Datei | Was entfernen |
|-------|--------------|
| `server/services/registry-manager.ts` | `trackIntendedPinChange()`, `lastPinChangeTime` Map, Debounce in `updatePinValue()`/`updatePinPWM()`, `telemetry.intendedPinChanges`, `telemetry.pinChanges` Inkrementierungen |
| `server/services/sandbox-runner.ts` | `trackIntendedPinChange()` Aufrufe, direkte `onPinState()` Aufrufe |
| `server/routes.ts` | Individueller `onPinState` Callback (wird durch Batcher ersetzt) |

---

## 9. Umsetzungs-Reihenfolge

```
Phase   Aufgabe                                    Tests zuerst?
─────   ───────                                    ─────────────
1.1     PinStateBatcher Klasse schreiben           JA (Tests 1.1-1.10)
1.2     PinStateBatcher Unit Tests bestehen        -
2.1     Schema erweitern (pin_state_batch)         JA (Test 3.1)
2.2     routes.ts: onBatch Callback                JA (Test 2.2)
2.3     SandboxRunner: Batcher integrieren         JA (Tests 2.1, 2.4, 2.5)
2.4     RegistryManager: Telemetrie umstellen      JA (Test 2.3)
3.1     Client: pin_state_batch Handler            JA (Tests 4.1, 4.2)
3.2     Client: enqueuePinEventBatch()             JA (Tests 4.1)
4.1     Rückbau: Alte pin_state Logik entfernen    JA (Tests 5.1, 5.2)
4.2     Rückbau: Debounce-Code entfernen           JA (Test 5.2)
5.1     E2E Test mit 20-Pin Szenario               -
5.2     Manueller Test, Verifikation               -
```

---

## 10. Risiken und Offene Fragen

### R1: Timing-Genauigkeit
- **Risiko:** 50ms Tick kann zu grob sein für einige Anwendungen
- **Mitigation:** Tick-Interval konfigurierbar machen (min 16ms = 60fps)
- **GUI-Hinweis:** Wenn Loss > 0%, Tooltip: "Darstellung ist downgesampelt"

### R2: pinMode Events
- **Risiko:** `pin_mode` Events sind strukturell wichtig (pin defined: true)
- **Mitigation:** `pin_mode` Events werden SOWOHL im Batcher als auch im RegistryManager verarbeitet
- RegistryManager sendet weiterhin sofort `io_registry` bei neuen Pin-Definitionen

### R3: Pause während Batch-Intervall
- **Risiko:** Pause kann mitten in einem Tick-Intervall kommen
- **Mitigation:** `pause()` stoppt Timer, pending Events bleiben erhalten bis Resume

### R4: Abwärtskompatibilität
- **Risiko:** Client muss sowohl altes `pin_state` als auch neues `pin_state_batch` verstehen
- **Mitigation:** Client behält den alten `pin_state` Handler als Fallback während der Übergangsphase
