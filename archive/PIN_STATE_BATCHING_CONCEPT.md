# Pin State Batching — Konzept & Aufräumplan

> **Status:** Phase 1 (Batching) ist implementiert. Die Telemetrie-Anzeige und der Aufräumplan stehen noch aus.
> Dieses Dokument ist die **Single Source of Truth** für alle weiteren Arbeiten.

---

## 1. Architektur (IST nach Phase 1)

```
┌──────────────┐    stderr     ┌──────────────────┐                     ┌────────────┐
│ C++ Simulator │ ──────────► │ SandboxRunner     │                     │ Browser    │
│              │  ~2000/sec   │ handleParsedLine()│                     │            │
│ 20 pins      │              │     │              │                     │            │
│ delay(10)    │              │     ▼              │                     │            │
└──────────────┘              │ PinStateBatcher    │  1 WS msg/tick     │            │
                              │ ┌────────────────┐ │ ─────────────────► │ Apply      │
                              │ │ Tick: 50ms     │ │  ~20 msg/sec       │ batch      │
                              │ │ Last-wins/pin  │ │  (pin_state_batch) │ to state   │
                              │ │ Batch & send   │ │                     │            │
                              │ └────────────────┘ │                     │            │
                              └──────────────────┘                     └────────────┘
```

### Datenfluss (komplett)

```
Schritt  Komponente                  Frequenz        Aktion
──────  ──────────                  ──────────      ──────
  1     C++ Simulator               ~2000/sec       digitalWrite(pin, val) → stderr
  2     SandboxRunner.parse         ~2000/sec       [[PIN_VALUE:pin:val]] → parsed object
  3     handleParsedLine            ~2000/sec       Dispatch:
        3a  PinStateBatcher.enqueue ~2000/sec         Sammelt in Map (letzter Wert/Pin gewinnt)
        3b  RegistryManager         ~2000/sec         updatePinValue() – nur incomingEvents++
  4     PinStateBatcher.tick        20/sec (50ms)   Sendet Batch aus Map → onBatch callback
  5     routes.ts onPinStateBatch   20/sec          Sendet pin_state_batch WebSocket-Message
  6     Client onmessage           20/sec          Empfängt pin_state_batch
  7     enqueuePinEvent()          20/sec          Events in pendingEvents Map (rAF-Batch)
  8     rAF flush                  60/sec          Wendet Events auf PinState[] an
  9     React render               60/sec          UI Update
```

---

## 2. Telemetrie: Analyse der User-Anforderungen

Der User möchte in der UI folgendes sehen:

| # | Anforderung | Sinnhaftigkeit | Empfehlung |
|---|---|---|---|
| 1 | **Pin-Änderungen vom Programm (Echtzeit, /s)** | ✅ Sinnvoll | `intendedPinChangesPerSecond` – bereits im Batcher vorhanden |
| 2 | **Dropped Changes (pro Sekunde, aufsummiert)** | ✅ Sinnvoll, zeigt Datenverlust | **Neu:** `droppedPinChangesPerSecond = intended - actual` |
| 3 | **Pin-Änderungen pro Batch (Durchschnitt)** | ✅ Sinnvoll, zeigt Batch-Effizienz | **Neu:** `avgStatesPerBatch = actual / sentBatches` |
| 4 | **Versendete Batches pro Sekunde** | ✅ Sinnvoll, zeigt ob Batcher arbeitet | **Neu:** `batchesPerSecond` aus PinStateBatcher |

### Verbesserungsvorschläge

1. **"Loss: 73%"** ist irreführend — es klingt wie ein Fehler. Besser: "Dropped" oder "Dedupliziert". Bei `delay(10)` mit 20 Pins ist es **erwartet**, dass ~75% der Werte dedupliziert werden (100 loops/sec × 20 Pins = 2000 Events, aber nur ~400 unique pin:stateType-Änderungen pro 50ms-Tick sind relevant).

2. **Die aktuellen Felder `incomingEvents`/`sentBatches`/`batchEfficiency`/`eventsPerSecond`** tracken IO_REGISTRY-Events (strukturelle Pin-Definitionen), **nicht** Pin-State-Änderungen. Die Namen sind verwirrend und sollten entweder umbenannt oder entfernt werden.

3. **`pinChangesPerSecond`** ist ein redundanter Alias für `actualPinChangesPerSecond`. Sollte entfernt werden.

4. **`isThrottled`** ist überflüssig — es ist einfach `droppedPinChangesPerSecond > 0`. Entfernen.

### Neue Telemetrie-Metriken (SOLL)

Die `PerformanceMetrics` sollen auf diese relevanten Felder reduziert werden:

```typescript
interface PerformanceMetrics {
  timestamp: number;
  
  // Pin State Batching (Kern-Metriken)
  intendedPinChangesPerSecond: number;   // Alle enqueue()-Aufrufe pro Sekunde
  actualPinChangesPerSecond: number;     // Im Batch gesendete States pro Sekunde
  droppedPinChangesPerSecond: number;    // intended - actual (deduplizierte/übersprungene)
  batchesPerSecond: number;              // Anzahl versendeter Batches pro Sekunde
  avgStatesPerBatch: number;             // actual / batches (wie viele States pro Batch)
  
  // Serial Output
  serialOutputPerSecond: number;         // Serial-Events pro Sekunde
}
```

### UI-Anzeige (SOLL)

Im Arduino-Board Header (Debug-Mode), kompakt:

```
PIN CHANGES                          BATCHING
1520 /s (380 dropped)               20 bat/s · 19 st/bat
```

Erklärung der Felder:
- **1520 /s** = `intendedPinChangesPerSecond` (was das Programm versucht)
- **(380 dropped)** = `droppedPinChangesPerSecond` (dedupliziert, Klammer betont, dass es kein Fehler ist)
- **20 bat/s** = `batchesPerSecond` (versendete WebSocket-Batches pro Sekunde)
- **19 st/bat** = `avgStatesPerBatch` (durchschnittliche Pin-States pro Batch)

Optional bei Hover/Tooltip:
- "Das Programm erzeugt 1520 Pin-Änderungen/s. Der Batcher fasst diese in 20 Batches/s zusammen (je ~19 States). 380 identische Zwischenwerte werden dedupliziert."

---

## 3. IST-Zustand: Legacy-Code & Altlasten

### 3.1 Tote Felder in `RegistryManager.telemetry`

| Feld | Datei | Status |
|---|---|---|
| `telemetry.pinChanges` | `server/services/registry-manager.ts:85` | **Tot** – wird nirgends inkrementiert, nur resettet |
| `telemetry.intendedPinChanges` | `server/services/registry-manager.ts:86` | **Tot** – wird nirgends inkrementiert, nur resettet |

### 3.2 Verwirrende Felder in `PerformanceMetrics`

| Feld | Was es trackt | Problem |
|---|---|---|
| `incomingEvents` | IO_REGISTRY Events (addPin, updatePinMode, updatePinValue, updatePinPWM) | Name suggeriert Pin-Events, trackt aber gemischte Registry-Events |
| `sentBatches` | Anzahl `sendNow()` Aufrufe für IO_REGISTRY | Name suggeriert PinStateBatcher-Batches |
| `eventsPerSecond` | `incomingEvents / time` | Verwirrend – nicht Pin-Events |
| `batchEfficiency` | `incomingEvents / sentBatches` | Verwirrend – nicht PinState-Batch-Effizienz |

### 3.3 Redundante/Überflüssige Felder in `PerformanceMetrics`

| Feld | Problem | Aktion |
|---|---|---|
| `pinChangesPerSecond` | Immer identisch mit `actualPinChangesPerSecond` | **Entfernen** |
| `isThrottled` | Immer `droppedPinChangesPerSecond > 0` | **Entfernen** |

### 3.4 Nutzlose Methoden in `RegistryManager`

| Methode | Problem |
|---|---|
| `updatePinValue(pin, value)` | Macht nur `incomingEvents++` und ein debug-Log. Ändert keine Registry-Daten. |
| `updatePinPWM(pin, value)` | Identisch nutzlos. |

### 3.5 `TelemetryPeaks` in `use-telemetry-store.ts`

Trackt Peaks für `eventsPerSecond` und `batchEfficiency` – beides IO_REGISTRY-Metriken, die für den User irrelevant sind. Keine Peaks für die relevanten Pin-Change-Metriken.

---

## 4. Aufräumplan (Schritt-für-Schritt)

### Phase A: PinStateBatcher erweitern (neue Telemetrie-Daten)

#### A.1 PinStateBatcher: Batch-Zähler hinzufügen

**Datei:** `server/services/pin-state-batcher.ts`

**Änderungen:**
1. Neues Feld `private batchCount = 0;` hinzufügen
2. In `flush()`: nach `this.config.onBatch(...)` → `this.batchCount++` inkrementieren
3. `getTelemetryAndReset()` erweitern:
   ```typescript
   getTelemetryAndReset(): { intended: number; actual: number; batches: number } {
     const result = {
       intended: this.intendedCount,
       actual: this.actualCount,
       batches: this.batchCount,
     };
     this.intendedCount = 0;
     this.actualCount = 0;
     this.batchCount = 0;
     return result;
   }
   ```

**Tests:**
- Test in `tests/server/services/pin-state-batcher.test.ts` ergänzen:
  ```
  GIVEN PinStateBatcher mit 20 Events für 10 Pins (2 Ticks)
  WHEN  getTelemetryAndReset() aufgerufen wird
  THEN  { intended: 20, actual: ~10-20, batches: 2 }
  ```

#### A.2 PerformanceMetrics vereinfachen

**Datei:** `server/services/registry-manager.ts`

Interface `PerformanceMetrics` ersetzen durch:

```typescript
export interface PerformanceMetrics {
  timestamp: number;
  
  // Pin State Batching
  intendedPinChangesPerSecond: number;
  actualPinChangesPerSecond: number;
  droppedPinChangesPerSecond: number;
  batchesPerSecond: number;
  avgStatesPerBatch: number;
  
  // Serial Output
  serialOutputPerSecond: number;
}
```

`getPerformanceMetrics()` vereinfachen: nur noch `PinStateBatcher.getTelemetryAndReset()` + `serialOutputEvents` auswerten.

Entfernen:
- `incomingEvents`, `sentBatches`, `eventsPerSecond`, `batchEfficiency` (IO_REGISTRY Metriken)
- `pinChangesPerSecond` (Alias)
- `isThrottled` (redundant)
- `pinChangeLossPercentage` (durch `droppedPinChangesPerSecond` ersetzt)

#### A.3 Schema aktualisieren

**Datei:** `shared/schema.ts`

`sim_telemetry.metrics` Zod-Schema auf die neuen Felder anpassen:

```typescript
z.object({
  type: z.literal("sim_telemetry"),
  metrics: z.object({
    timestamp: z.number(),
    intendedPinChangesPerSecond: z.number(),
    actualPinChangesPerSecond: z.number(),
    droppedPinChangesPerSecond: z.number(),
    batchesPerSecond: z.number(),
    avgStatesPerBatch: z.number(),
    serialOutputPerSecond: z.number(),
  }),
}),
```

#### A.4 Client-Store aktualisieren

**Datei:** `client/src/hooks/use-telemetry-store.ts`

1. `TelemetryMetrics` Interface auf neue Felder anpassen (wie `PerformanceMetrics`)
2. `TelemetryPeaks` vereinfachen oder entfernen:
   - Entweder komplett entfernen (da bisher nur IO_REGISTRY-Peaks getrackt wurden)
   - Oder anpassen: Peak für `intendedPinChangesPerSecond` und `batchesPerSecond`
3. `pushTelemetry()` Peak-Tracking auf neue Felder umstellen

#### A.5 UI-Anzeige aktualisieren

**Datei:** `client/src/components/features/arduino-board.tsx`

Die aktuelle Anzeige (ca. Zeile 838-858) ersetzen. Neue Anzeige:

```tsx
{debugMode && telemetry && isSimulationRunning && (
  <div className="ml-4 flex items-center gap-4 text-xs text-muted-foreground border-l border-muted-foreground/30 pl-4">
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-white/50">Pin Changes</span>
      <span className="text-sm font-mono text-white/90">
        {telemetry.intendedPinChangesPerSecond.toFixed(0)} /s
        {telemetry.droppedPinChangesPerSecond > 0 && (
          <span className="ml-1 text-amber-400/80">
            ({telemetry.droppedPinChangesPerSecond.toFixed(0)} dropped)
          </span>
        )}
      </span>
    </div>
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-white/50">Batching</span>
      <span className="text-sm font-mono text-white/90">
        {telemetry.batchesPerSecond.toFixed(0)} bat/s · {telemetry.avgStatesPerBatch.toFixed(0)} st/bat
      </span>
    </div>
  </div>
)}
```

---

### Phase B: Toten Code entfernen

#### B.1 RegistryManager: Tote Telemetrie-Felder entfernen

**Datei:** `server/services/registry-manager.ts`

Entfernen:
1. `telemetry.pinChanges` (Zeile 85) – Feld-Deklaration
2. `telemetry.intendedPinChanges` (Zeile 86) – Feld-Deklaration
3. `this.telemetry.pinChanges = 0` in `getPerformanceMetrics()` (Zeile 222)
4. `this.telemetry.intendedPinChanges = 0` in `getPerformanceMetrics()` (Zeile 223)
5. `this.telemetry.pinChanges = 0` in `startCollection()` (Zeile 266)
6. `this.telemetry.intendedPinChanges = 0` in `startCollection()` (Zeile 267)

#### B.2 RegistryManager: IO_REGISTRY-Metriken entfernen

`incomingEvents` und `sentBatches` dienen nur der internen RegistryManager-Diagnose und gehören nicht in die `PerformanceMetrics`, die an den Client gesendet werden.

**Entfernen aus `PerformanceMetrics`:**
- `incomingEvents`
- `sentBatches`
- `eventsPerSecond`
- `batchEfficiency`

**Intern behalten** (für Debug-Logging, aber nicht mehr im Interface):
- `telemetry.incomingEvents` und `telemetry.sentBatches` können für `logger.debug()` bleiben, aber nicht mehr in die Metrics-Response.

#### B.3 RegistryManager: Nutzlose Methoden vereinfachen

`updatePinValue()` und `updatePinPWM()` machen nur `incomingEvents++` und ein Debug-Log. Da `incomingEvents` aus dem Metrics-Interface entfernt wird, können die Methoden zu leeren Stubs reduziert oder ganz entfernt werden.

**Empfehlung:** Methoden entfernen. Die Aufrufe in `sandbox-runner.ts` (handleParsedLine) ebenfalls entfernen.

Betroffene Stellen in `sandbox-runner.ts`:
- `this.registryManager.updatePinValue(...)` Aufrufe
- `this.registryManager.updatePinPWM(...)` Aufrufe

#### B.4 `resumeTelemetry()` bereinigen

In `resumeTelemetry()` werden `incomingEvents` und `sentBatches` resettet. Nach dem Entfernen dieser Felder wird die Methode vereinfacht.

---

### Phase C: Tests aufräumen

#### C.1 Tests LÖSCHEN (obsolet, testen alte Debounce-Architektur)

| Datei | Tests | Grund |
|---|---|---|
| `tests/server/services/telemetry-throttle-detection.test.ts` | 22 Tests (12 failing) | Testet Debounce-basierte Throttle-Erkennung, die durch PinStateBatcher ersetzt wurde |
| `tests/server/services/telemetry-pin-change-accuracy.test.ts` | 21 Tests (16 failing) | Testet Frequenz-Messung über updatePinValue()-Debouncing, dokumentiert Bugs die PinStateBatcher behebt |

#### C.2 Tests UMSCHREIBEN (Kern-Logik korrekt, aber auf neue Architektur anpassen)

| Datei | Tests | Was ändern |
|---|---|---|
| `tests/server/services/registry-manager-telemetry.test.ts` | 18 Tests (7 failing) | Pin-Change-Tests brauchen PinStateBatcher-Mock; Serial-Tests sind OK. Alternativ: Pin-Change-Tests löschen (PinStateBatcher hat eigene Tests) und nur Serial-Tests behalten |

#### C.3 Tests FIXEN (kleine Anpassungen)

| Datei | Tests | Was ändern |
|---|---|---|
| `tests/client/sim-cockpit.ui.test.tsx` | 1 Test (1 failing) | SimCockpit zeigt nur noch Link-State. Test auf Link-State-Prüfung umschreiben, oder Test löschen und neuen für die aktualisierte Telemetrie-Anzeige in arduino-board.tsx schreiben |
| `tests/server/services/sandbox-performance.test.ts` | 7 Tests (2 failing) | `runSketch()`-Signatur hat neuen `onPinStateBatch`-Parameter. Mock-Callback-Positionen anpassen. |

#### C.4 Tests BEHALTEN (alle bestehend)

| Datei | Tests | Status |
|---|---|---|
| `tests/server/services/pin-state-batcher.test.ts` | 10 Tests | ✅ Alle bestehend. Ergänzen um Batch-Zähler-Test (Phase A.1) |
| `tests/client/use-telemetry-store.test.ts` | 10 Tests | ✅ Alle bestehend. Mock-Daten auf neue Felder anpassen |

---

## 4.5 E2E Test-Spezifikation für Telemetrie-Metriken

### Überblick

Die E2E-Tests verifizieren, dass die neuen Telemetrie-Metriken korrekt berechnet, über WebSocket gesendet und in der Arduino-Board-UI angezeigt werden. Tests müssen auf die neue UI-Struktur mit zwei Metriken-Blöcken ("PIN CHANGES" und "BATCHING") abzielen.

### E2E Test 1: PIN-CHANGES und BATCHING Metriken werden angezeigt

**Szenario:**
1. Master-Beispiel laden (pin toggling mit delay(10))
2. Simulation starten
3. 5 Sekunden warten (um stabile Metriken zu erhalten)
4. UI überprüfen: Telemetrie-Anzeige im Debug-Mode

**Assertions (nach Phase A umgesetzt):**

```
✅ PIN CHANGES Section ist sichtbar
✅ intendedPinChangesPerSecond > 0 (z.B. "1520 /s")
✅ droppedPinChangesPerSecond > 0 (z.B. "(380 dropped)")
✅ BATCHING Section ist sichtbar
✅ batchesPerSecond > 0 (z.B. "20 bat/s")
✅ avgStatesPerBatch > 0 (z.B. "19 st/bat")
```

**Max Erwartete Werte (bei Pin-Toggling mit delay(10)):**
- `intendedPinChangesPerSecond`: ~1500-2000 (depend auf Simulator)
- `droppedPinChangesPerSecond`: ~300-400 (ca. 20-25% Deduplication)
- `batchesPerSecond`: 18-22 (50ms ticks = ~20/sec)
- `avgStatesPerBatch`: 30-80 (depending auf overlap)

**Datei:** `e2e/pin-state-batching-telemetry.spec.ts` (neu)

### E2E Test 2: Metriken bleiben konsistent über Zeit

**Szenario:**
1. Sketch laden und Simulation starten
2. Alle 2 Sekunden über 10 Sekunden hinweg Metriken auslesen
3. Überprüfen: Metriken sollten relativ stabil sein (±20% Abweichung)

**Assertions:**
```
✅ intendedPinChangesPerSecond bleibt ±20% stabil
✅ actualPinChangesPerSecond bleibt ±20% stabil
✅ batchesPerSecond bleibt ±20% stabil (20 ±4)
```

### E2E Test 3: Metriken sind 0 wenn Simulation gestoppt

**Szenario:**
1. Sketch laden und Simulation starten
2. 2 Sekunden warten (stabile Metriken)
3. Simulation stoppen
4. Sofort Metriken auslesen

**Assertions:**
```
✅ intendedPinChangesPerSecond = 0
✅ actualPinChangesPerSecond = 0
✅ batchesPerSecond = 0
```

### E2E Test 4: WebSocket pin_state_batch Messages werden korrekt empfangen (Netzwerk-Validierung)

**Szenario:**
1. Simulation starten
2. WebSocket-Traffic überwachen
3. pin_state_batch messages zählen über 5 Sekunden
4. Durchschnitt berechnen

**Assertions:**
```
✅ pin_state_batch Messages werden gesendet (min 80 Messages in 5 sec = 16/sec, max 120)
✅ Jedes Message hat states Array
✅ states Array hat min 1, max 100+ Einträge
```

### Test-Implementierungs-Checkliste

- [ ] Test-Fixture für Telemetrie-Element-Selektoren erstellen (z.B. `[data-testid="telemetry-pin-changes"]`)
- [ ] Helfer-Funktion `getTelemetryMetrics()` → `{intended, actual, batches, avgStatesPerBatch}` aus UI
- [ ] Helfer-Funktion für WebSocket Message Capture
- [ ] Test 1 schreiben (Anzeige sichtbar)
- [ ] Test 2 schreiben (Stabilität)
- [ ] Test 3 schreiben (Null bei Stop)
- [ ] Test 4 schreiben (WebSocket-Validierung)

---

## 5. Umsetzungs-Reihenfolge

```
Phase   Schritt   Aufgabe                                          Dateien
─────   ──────   ───────                                          ───────
E2E     0        E2E-Tests implementieren (SOLLEN FAILEN)         e2e/pin-state-batching-telemetry.spec.ts
        
A.1     1        PinStateBatcher: batchCount hinzufügen           pin-state-batcher.ts, pin-state-batcher.test.ts
A.2     2        PerformanceMetrics: Interface vereinfachen        registry-manager.ts
A.3     3        Schema: sim_telemetry Felder anpassen             schema.ts
A.4     4        Client Store: TelemetryMetrics anpassen           use-telemetry-store.ts
A.5     5        UI: arduino-board.tsx Anzeige neu                 arduino-board.tsx

B.1     6        Tote Felder entfernen (pinChanges, etc.)         registry-manager.ts
B.2     7        IO_REGISTRY Metriken aus Interface entfernen     registry-manager.ts
B.3     8        updatePinValue/updatePinPWM entfernen            registry-manager.ts, sandbox-runner.ts
B.4     9        resumeTelemetry() bereinigen                     registry-manager.ts

C.1     10       Obsolete Tests löschen                           2 Test-Dateien
C.2     11       Telemetrie-Tests umschreiben                     registry-manager-telemetry.test.ts
C.3     12       Tests fixen (Signatur/UI)                        sim-cockpit.ui.test.ts, sandbox-performance.test.ts
C.4     13       Bestehende Tests anpassen (Mock-Daten)           use-telemetry-store.test.ts

        14       ./run-tests.sh → alle Tests grün                 -
        15       git commit                                        -
```

### Wichtig für Agenten

- **Schritt 0 (E2E-Tests)** wird zuerst implementiert und sollte FAILEN, bis Phase A abgeschlossen ist
- **Nach Phase A** sollten E2E-Tests bestanden werden
- **Nach jedem Schritt:** `./run-tests.sh` ausführen
- **Schritt 1-5** sind voneinander abhängig und ändern das gesamte Interface → am besten als ein Block umsetzen
- **Schritt 6-9** sind unabhängige Aufräumarbeiten
- **Schritt 10-13** räumen die Tests auf
- **Erst Schritt 14** prüft, ob alles zusammen funktioniert

---

## 6. Dateien-Änderungsübersicht

### Zu ändernde Dateien

| Datei | Was ändern |
|---|---|
| `server/services/pin-state-batcher.ts` | `batchCount` Feld + Zählung + erweiterte `getTelemetryAndReset()` |
| `server/services/registry-manager.ts` | `PerformanceMetrics` Interface neu, `getPerformanceMetrics()` vereinfachen, tote Felder entfernen, `updatePinValue()`/`updatePinPWM()` entfernen |
| `server/services/sandbox-runner.ts` | `updatePinValue()`/`updatePinPWM()` Aufrufe entfernen |
| `shared/schema.ts` | `sim_telemetry.metrics` Zod-Schema auf neue Felder |
| `client/src/hooks/use-telemetry-store.ts` | `TelemetryMetrics` Interface, `TelemetryPeaks` anpassen, Peak-Tracking |
| `client/src/components/features/arduino-board.tsx` | Telemetrie-Anzeige komplett neu (Zeilen ~838-858) |

### Zu löschende Dateien

| Datei | Grund |
|---|---|
| `tests/server/services/telemetry-throttle-detection.test.ts` | Testet obsolete Debounce-Architektur |
| `tests/server/services/telemetry-pin-change-accuracy.test.ts` | Testet Bugs die PinStateBatcher behebt |

### Zu fixende Test-Dateien

| Datei | Was ändern |
|---|---|
| `tests/server/services/pin-state-batcher.test.ts` | Test für `batches` in `getTelemetryAndReset()` ergänzen |
| `tests/server/services/registry-manager-telemetry.test.ts` | Pin-Change-Tests löschen, Serial-Tests behalten, neue Felder testen |
| `tests/client/sim-cockpit.ui.test.tsx` | Auf Link-State-Test umschreiben oder löschen |
| `tests/server/services/sandbox-performance.test.ts` | `runSketch()` Mock-Signatur anpassen (neuer `onPinStateBatch` Parameter) |
| `tests/client/use-telemetry-store.test.ts` | Mock-Daten auf neue `TelemetryMetrics`-Felder anpassen |
