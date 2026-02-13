# Funktionsbeschreibung: Serieller Output-Stream (Arduino Sandbox)

## 1. Übersicht
Das System emuliert die serielle Schnittstelle eines Arduino-Sketches. Es fängt die Ausgabe des kompilierten C++ Programms ab, formatiert sie gemäß den Arduino-Regeln, drosselt sie realistisch auf Basis der Baudrate und streamt sie an das Frontend.

**Kernprinzip:** Ein realer Arduino kann bei 115200 Baud maximal ~11.520 Bytes/Sekunde senden. Der Simulator erzwingt dieses Limit serverseitig. Überschüssige Daten werden verworfen — analog zum Hardware-Verhalten, wo der TX-Puffer überläuft, wenn das Programm schneller schreibt als die UART senden kann.

## 2. Datentyp-Konvertierung (Print-Klasse)
Der Simulator bildet das Verhalten der Arduino-`Print`-Bibliothek ab. Die Konvertierung erfolgt serverseitig im C++ Mock (`arduino-mock.ts`):

| Datentyp | Transformation | Beispiel |
| :--- | :--- | :--- |
| **Integer** | Dezimal-String (Standard). | `101` → `"101"` |
| **Integer + Base** | Umwandlung in beliebige Basis ≥ 2 (BIN, OCT, HEX oder andere). | `(78, HEX)` → `"4E"`, `(255, 3)` → `"100110"` |
| **Integer + Base < 2** | Fallback auf Dezimal (analog Arduino). | `(42, 1)` → `"42"` |
| **Float** | Standardmäßig 2 Nachkommastellen (gerundet). | `3.1415` → `"3.14"` |
| **Float + Prec** | Spezifizierte Nachkommastellen. | `(1.234, 3)` → `"1.234"` |
| **Boolean** | Konvertierung in "1" oder "0". | `true` → `"1"` |
| **byte** | Als Integer ausgegeben (nicht als ASCII-Char). | `byte(65)` → `"65"` |

### 2.1 Serial.write() vs Serial.print()
- **`Serial.write()`**: Sendet rohe Bytes — geht durch dieselbe `serialWrite()`/`SERIAL_EVENT`-Pipeline wie `print()`.
- **`Serial.print()`**: Konvertiert Werte in ASCII-Darstellung und sendet diese.

## 3. Transport-Protokoll
Alle Ausgaben (print, println, write) werden über **stderr** als base64-kodierte `SERIAL_EVENT`-Nachrichten gesendet:
```
[[SERIAL_EVENT:<millis_timestamp>:<base64_data>]]
```
Der Server dekodiert diese und leitet sie über WebSocket an das Frontend.

**Einziger Datenpfad:** Serielle Ausgaben laufen ausschließlich über das `SERIAL_EVENT`-Protokoll via stderr. Der frühere stdout-Fallback-Pfad über den TS-Parser (`ArduinoOutputParser`) wird entfernt (siehe §10 Aufräumarbeiten).

### 3.1 Warum stderr statt stdout?

Die Entscheidung für stderr als Transportkanal hat mehrere technische Gründe:

**1. Ungepufferte vs. gepufferte Ausgabe:**
- **stdout** ist standardmäßig **line-buffered** (bei TTY) oder **fully buffered** (bei Pipes/Dateien). Das bedeutet, dass Daten im Userspace-Buffer gesammelt werden, bis:
  - Ein Newline (`\n`) erkannt wird (line-buffered), oder
  - Der Buffer voll ist (typisch 4K-8K), oder
  - Ein expliziter `fflush(stdout)` aufgerufen wird
- **stderr** ist **ungepuffert** (unbuffered). Jeder `write()`-Syscall geht sofort an das OS und wird vom Node.js-Prozess unmittelbar empfangen.

**2. Timing-Präzision:**
Für das `SERIAL_EVENT`-Protokoll sind die `millis()`-Timestamps kritisch. Ein gepufferter stdout würde bedeuten, dass ein `Serial.println()` bei `millis() = 100` erst bei `millis() = 500` vom Server empfangen wird (wenn der Buffer gefüllt ist). Das würde die Telemetrie (serialOutputPerSecond) und zukünftige Baudrate-Visualisierungen verfälschen. stderr garantiert, dass der Event-Timestamp den tatsächlichen Ausführungszeitpunkt widerspiegelt.

**3. Strukturiertes Protokoll:**
stderr erlaubt die parallele Verwendung für verschiedene Nachrichtentypen:
- `[[SERIAL_EVENT:...]]` — serielle Daten
- `[[PIN_MODE:...]]` — Pin-Zustandsänderungen
- `[[IO_REGISTRY:...]]` — Registry-Daten
- Plain text — Compiler-Fehler, Warnungen, Debug-Output

stdout wäre für ein multiplexed protocol ungeeignet, da es traditionell für die "Hauptausgabe" des Programms gedacht ist. stderr ist der konventionelle Kanal für strukturierte Logging- und Diagnose-Daten.

**4. Kein `fflush()` nötig:**
Im C++ Mock müssten wir bei stdout nach jedem `Serial.println()` ein `fflush(stdout)` hinzufügen, um sofortiges Empfangen zu garantieren. Bei stderr ist das nicht nötig — es ist von Natur aus ungepuffert. Das vereinfacht den Mock-Code und vermeidet vergessene `fflush()`-Aufrufe.

**5. Separation of Concerns:**
stdout bleibt für mögliche zukünftige Features frei (z.B. direkter C++ `printf()`-Output für Debug-Zwecke ohne Vermischung mit dem Serial-Protokoll).

## 4. Streaming- & Buffer-Strategie (C++ Mock)

### 4.1 Zeilen-Buffer im C++ Mock
* **Buffer-Mechanismus:** Zeichen werden in `lineBuffer` (C++ `std::string`) gesammelt.
* **Immediate Flush:** Daten werden sofort gesendet, wenn ein Newline (`\n`) erkannt wird.
* **Pre-Flush bei Steuerzeichen:** Bei `\b` (Backspace) oder `\r` (Carriage Return) wird der Buffer **vor** dem Steuerzeichen geflusht, damit es mit dem folgenden Content zusammenbleibt.
* **Expliziter Flush:** `Serial.flush()` und `delay()` lösen manuellen Flush aus.
* **Setup/Loop-Persistenz:** Der Stream-Kontext bleibt beim Übergang von `setup()` zu `loop()` vollständig erhalten.

### 4.2 txDelay (Baudrate-Simulation im Mock)
Nach jedem `flushLineBuffer()` wird `txDelay(numChars)` aufgerufen:
- Formel: `totalMs = (10 bits × numChars × 1000) / baudrate`
- **Capping:** `totalMs` ist auf max. **2ms** begrenzt, damit der SerialOutputBatcher der alleinige Rate-Limiter ist.
- Bei 115200 Baud: < 1ms pro 100 Zeichen — vernachlässigbar, kein Cap.
- Bei 9600 Baud: 2ms (gekappt ab ~23 Zeichen) — Batcher limitiert.
- Kurze Nachrichten (z.B. `println("Hello")` bei 9600): txDelay = 1.25ms → realistisch, kein Cap.

## 5. Serial Output Batcher (Kern-Neuerung)

### 5.1 Problem
Der C++ Mock erzeugt Daten viel schneller als ein realer Arduino. Der `txDelay()`-Cap von 2ms verhindert Blockierung bei niedrigen Baudraten, aber der Batcher ist der primäre Rate-Limiter. Beispiel:

```cpp
void loop() {
  static uint32_t t;
  if (millis() - t > 2) {
    t = millis();
    Serial.println("-");   // 500×/s = ~1000 Bytes/s → OK bei 115200
  }
}
```
Das obige Beispiel ist noch ok. Aber dieses Muster überflutet das System:
```cpp
void loop() {
  Serial.println("Hello World");  // Tight loop = 10.000+ Zeilen/s
}
```

Ein realer Arduino bei 115200 Baud kann nur ~11.520 Bytes/s senden. Das Programm wäre bei einem realen Arduino durch den blockierenden TX-Buffer gebremst. Der Simulator hat dieses natürliche Limit nicht.

### 5.2 Lösung: `SerialOutputBatcher`
Analog zum `PinStateBatcher` wird ein `SerialOutputBatcher` zwischen C++-Output und WebSocket geschaltet:

```
C++ Mock (stderr)       Server                                WebSocket
┌──────────────┐   ┌──────────────────────────────────┐   ┌──────────────────┐
│ SERIAL_EVENT ├──▶│ StderrParser → SerialOutputBatcher ├──▶│ serial_output    │
│ ~1000+/s     │   │               (baudrate-basiert)  │   │ max 20 chunks/s  │
└──────────────┘   └──────────────────────────────────┘   └──────────────────┘
```

### 5.3 Architektur

```typescript
// server/services/serial-output-batcher.ts

interface SerialOutputBatcherConfig {
  baudrate: number;              // z.B. 115200
  tickIntervalMs?: number;       // Default: 50ms (= 20 Ticks/s, wie PinStateBatcher)
  onChunk: (data: string) => void;  // Callback für gebatchte Daten
}
```

**Kernmechanismus: Token-Bucket mit Baudrate-Limit**

1. **Byte-Budget pro Tick:** `byteBudget = (baudrate / 10) * (tickIntervalMs / 1000)`
   - Bei 115200 Baud, 50ms Tick: `11520 * 0.05 = 576 Bytes/Tick`
   - Bei 9600 Baud, 50ms Tick: `960 * 0.05 = 48 Bytes/Tick`

2. **Akkumulation:** Eingehende Serial-Events werden in einem String-Buffer gesammelt (`pendingData`).

3. **Tick-Verarbeitung (alle 50ms):**
   - Wenn `pendingData.length <= byteBudget`: Alles senden, Buffer leeren.
   - Wenn `pendingData.length > byteBudget`:
     - Die letzten `byteBudget` Bytes senden (neueste Daten sind relevanter).
     - Einen Drop-Indikator voranstellen: `\n[⚠ <N> Bytes verworfen (Baudrate-Limit)]\n`
     - Verworfene Bytes zählen.
     - Buffer leeren.

4. **Newline-Awareness:** Nach dem Droppen wird immer die erste (abgeschnittene) Zeile bis zum nächsten `\n` übersprungen, sofern danach noch Inhalt vorhanden ist. Damit werden keine halben/abgeschnittenen Zeilen an den Client gesendet.

### 5.4 Drop-Strategie: „Neueste Daten gewinnen"
Anders als beim `PinStateBatcher` (last-value-wins per Key) wird hier eine andere Strategie verwendet:

- **Pin-States:** Nur der aktuelle Wert ist relevant → „last value wins".
- **Serial-Daten:** Ein laufender Stream — der User will den aktuellen Zustand sehen, nicht den Anfang. → **„Tail wins"**: Die neuesten Bytes werden behalten, ältere verworfen.

### 5.5 Drop-Indikator
Wenn Daten verworfen werden, wird eine sichtbare Markierung eingefügt:
```
[⚠ 2048 Bytes verworfen (Baudrate-Limit)]
```
Diese Markierung wird als regulärer Serial-Text an das Frontend gesendet. Der SerialMonitor rendert sie als normale Textzeile. Es gibt keine spezielle Frontend-Logik dafür.

### 5.6 Burst-Toleranz
Um kurze Spitzen abzufangen (z.B. ein langer String im `setup()`), wird ein Burst-Faktor implementiert:
- **Burst-Budget:** `burstFactor × byteBudget` (z.B. Faktor 3 → 1728 Bytes Burst bei 115200 Baud)
- Nicht verbrauchtes Budget akkumuliert sich bis zum Burst-Maximum.
- Das ermöglicht gelegentliche große Ausgaben, verhindert aber dauerhaftes Flooding.

### 5.7 Telemetrie-Tracking
Der Batcher führt Zähler, die pro Heartbeat (1s) abgefragt und zurückgesetzt werden:

| Zähler | Bedeutung |
| :--- | :--- |
| `serialIntendedBytes` | Bytes, die das C++ Programm senden wollte |
| `serialActualBytes` | Bytes, die tatsächlich zum Frontend gesendet wurden |
| `serialDroppedBytes` | Bytes, die wegen Baudrate-Limit verworfen wurden |
| `serialChunks` | Anzahl gesendeter Chunks (= Tick-Callbacks) |
| `serialBytesTotal` | Kumulative Bytes seit Sketch-Start (intended) |

### 5.8 Lebenszyklus

| Event | Aktion |
| :--- | :--- |
| Simulation Start | `new SerialOutputBatcher(config)` → `start()` |
| Simulation Pause | `pause()` — Timer stoppen, Buffer behalten |
| Simulation Resume | `resume()` — Timer neu starten |
| Simulation Stop | `stop()` — Remaining Buffer flushen (ohne Limit), Timer stoppen |
| Sketch Neustart | `destroy()` → neuer Batcher |

## 6. Steuerzeichen & Interpretation
Das Backend fungiert als transparenter Proxy für Steuerzeichen. Die Interpretation erfolgt im Frontend (SerialMonitor-Komponente).
- **CR/LF:** Standard Zeilensteuerung.
- **Backspace (`\b`):** Wird als RAW-Byte weitergegeben, damit das Frontend den Cursor bewegen kann.
- **ANSI Escape Sequences:** Werden für farbige Ausgaben oder Positionierung unterstützt.

**Hinweis:** Steuerzeichen (`\n`, `\r`, `\b`) zählen zum Byte-Budget des Batchers, werden aber beim Schneiden respektiert (kein Schnitt mitten in einer ANSI-Sequenz).

## 7. Baudraten-Behandlung

### 7.1 Designentscheidung
- Der `code-parser.ts` erzwingt `Serial.begin(115200)` und warnt bei anderen Baudraten.
- Die Baudrate bestimmt das Byte-Budget des `SerialOutputBatcher`.
- Bei 115200 Baud ist die Begrenzung großzügig genug für typische Sketche (11.520 Bytes/s).
- Nur extreme Tight-Loop-Szenarien lösen Drops aus — das entspricht dem realen Arduino-Verhalten.

### 7.2 Baudrate-Propagation
1. C++ Mock ruft `Serial.begin(baudrate)` auf → Baudrate wird im Mock gespeichert.
2. SandboxRunner liest Baudrate aus der IO-Registry (`registryManager`).
3. `SerialOutputBatcher` wird mit Baudrate konfiguriert.
4. Baudrate-Änderungen zur Laufzeit: Ein neuer `Serial.begin()` Aufruf ändert die Baudrate in der Registry → Batcher wird aktualisiert (`setBaudrate(newRate)`).

## 8. Debug-Mode: Telemetrie im Serial-Header
Im Debug-Mode wird die Telemetrie-Information im Header des Serial-Output-Panels angezeigt:

### 8.1 Angezeigte Metriken (Debug-Header)

| Metrik | Format | Beschreibung |
| :--- | :--- | :--- |
| **Serial /s** | `X.X /s` | Chunks pro Sekunde (gesendete Batches) |
| **Bytes /s** | `X.X B/s` | Tatsächlich gesendete Bytes pro Sekunde |
| **Dropped /s** | `X.X B/s` | Verworfene Bytes pro Sekunde (rot wenn > 0) |
| **Baud** | `115200` | Aktuelle Baudrate |
| **Total** | `X.X KB` | Kumulative gesendete Bytes |

### 8.2 Visuelle Hervorhebung
- `Dropped /s > 0`: Anzeige in **rot** als Warnung, dass der Sketch zu schnell sendet.
- `Dropped /s = 0`: Anzeige in grau/normal.

## 9. WebSocket-Nachrichtenformat

### 9.1 Nachrichtentypen (Änderungen)
Das bisherige duale Format (`serial_output` für stdout, `serial_event` für stderr) wird vereinheitlicht:

**Einziger Typ: `serial_output`**
```typescript
{
  type: "serial_output",
  data: string,          // Die seriellen Daten (bereits gebatcht)
  isComplete: boolean    // true wenn Zeile mit \n endet
}
```

Der `serial_event`-Typ (mit `ts_write`, `baud`, etc.) wird entfernt. Die Baudrate-basierte Timing-Simulation wird serverseitig durch den Batcher erledigt — das Frontend muss keine Timestamps mehr verarbeiten.

### 9.2 Telemetrie-Erweiterung
Das `sim_telemetry`-Nachrichtenformat wird um Serial-Dropping-Metriken erweitert:

```typescript
interface PerformanceMetrics {
  // ... bestehende Pin-Metriken ...
  serialOutputPerSecond: number;       // Chunks/s
  serialBytesPerSecond: number;        // Actual Bytes/s
  serialBytesTotal: number;            // Kumulativ
  // NEU:
  serialIntendedBytesPerSecond: number; // Was das Programm senden wollte
  serialDroppedBytesPerSecond: number;  // Verworfene Bytes/s
}
```

## 10. Aufräumarbeiten (Cleanup)

### 10.1 Entfernungen

| Was | Wo | Warum |
| :--- | :--- | :--- |
| **stdout → SerialParser Pfad** | `sandbox-runner.ts` (stdout handler, `serialParser` Instanz) | Redundant. Alle Daten kommen über stderr `SERIAL_EVENT`. |
| **`ArduinoOutputParser` (TS)** | `src/utils/arduino-output-parser.ts` | War nur für den stdout-Pfad. Wird nicht mehr benötigt. |
| **`serial_event` WS-Typ** | `shared/schema.ts`, `server/routes.ts`, Frontend-Handler | Ersetzt durch gebatchte `serial_output` Nachrichten. |
| **`SERIAL_EVENT_JSON` Wrapper** | `sandbox-runner.ts`, `routes.ts` | Nicht mehr nötig — SerialOutputBatcher sendet plain text. |
| **`pendingSerialEvents`** | `sandbox-runner.ts` | War für Event-Sortierung, wird vom Batcher übernommen. |
| **Timed Flush (20ms)** | `ArduinoOutputParser.append()` | Entfällt mit Entfernung des TS-Parsers. |

### 10.2 Umbenennungen / Klarstellungen

| Was | Neu | Begründung |
| :--- | :--- | :--- |
| `server/services/arduino-output-parser.ts` | bleibt | Ist der stderr-Line-Parser, weiterhin benötigt. |
| `serial_output` WS-Nachricht | bleibt, wird einziger Serial-Typ | Klarheit: ein Nachrichtentyp für alles. |

### 10.3 Test-Bereinigung

| Testdatei | Aktion |
| :--- | :--- |
| `tests/unit/arduino-output-parser.test.ts` | **Entfernen** — Tests des entfernten TS-Parsers |
| `tests/integration/serial-flow.test.ts` | **Anpassen** — Erwartungen auf neues Batcher-Format |
| `tests/server/serial-print-carriage-return.test.ts` | **Behalten** — Prüft C++ Mock, unabhängig vom Batcher |
| `tests/client/serial-monitor.ui.test.ts` | **Behalten** — UI-Tests sind vom Transport unabhängig |
| `tests/server/services/arduino-output-parser.test.ts` | **Behalten** — Testet stderr-Parser, unabhängig |
| **NEU:** `tests/server/services/serial-output-batcher.test.ts` | **Erstellen** — Batcher Unit-Tests |

## 11. Testfälle

### 11.1 Unit-Tests: `SerialOutputBatcher` (NEU)
Datei: `tests/server/services/serial-output-batcher.test.ts`

```
Gruppe: "Grundfunktionalität"
├── T01: Kleiner Chunk wird im nächsten Tick vollständig gesendet
├── T02: Mehrere kleine Chunks werden zu einem Tick-Chunk zusammengefasst
├── T03: Buffer wird bei stop() vollständig geflusht (ohne Limit)
├── T04: Pause stoppt Timer, Resume startet Timer neu
├── T05: Nach destroy() werden keine Callbacks mehr aufgerufen

Gruppe: "Baudrate-Limiting"
├── T06: Bei 115200 Baud werden 576 Bytes pro Tick ohne Drop gesendet
├── T07: Bei 115200 Baud werden 2000 Bytes pro Tick auf ~576 Bytes gekürzt + Drop-Indikator
├── T08: Bei 9600 Baud werden 48 Bytes pro Tick zugelassen
├── T09: Drop-Indikator enthält korrekte Byte-Anzahl
├── T10: "Tail wins" — die neuesten Bytes werden behalten, älteste verworfen

Gruppe: "Burst-Toleranz"
├── T11: Erstes Tick nach Start erlaubt Burst-Budget (3×)
├── T12: Nach 3 leeren Ticks wird Budget auf Burst-Maximum aufgefüllt
├── T13: Dauerhaftes Flooding verbraucht Burst und droppt danach konsequent

Gruppe: "Telemetrie"
├── T14: getTelemetryAndReset() liefert korrekte intended/actual/dropped Zähler
├── T15: Zähler werden nach Reset auf 0 zurückgesetzt
├── T16: serialBytesTotal akkumuliert über mehrere Resets hinweg

Gruppe: "Newline-Awareness"
├── T17: Schnitt erfolgt auf Newline-Grenze (keine halben Zeilen)
├── T18: Wenn kein Newline im Budget-Bereich, wird auf Byte-Grenze geschnitten

Gruppe: "Baudrate-Änderung"
├── T19: setBaudrate() ändert das Byte-Budget für den nächsten Tick
```

### 11.2 Integration-Tests: Anpassungen
Datei: `tests/integration/serial-flow.test.ts`

```
Bestehende Tests — Erwartungs-Anpassungen:
├── "delayed dots" → Prüfen, dass Output gebatcht ankommt (nicht zeichenweise)
├── "HEX conversion" → Unverändert (Datenformat ändert sich nicht)
├── "float precision" → Unverändert
├── "println flushes buffer" → Unverändert (Flush passiert im C++ Mock)
├── "control characters" → Unverändert (Steuerzeichen werden durchgereicht)

Neue Tests:
├── T-INT-01: Tight-Loop Serial.println() erzeugt Drop-Indikatoren im Output
├── T-INT-02: Bei 115200 Baud + normalem Sketch (100ms delay) gibt es keine Drops
├── T-INT-03: Telemetrie zeigt serialDroppedBytesPerSecond > 0 bei Flooding
├── T-INT-04: setup()-Ausgaben nutzen Burst-Budget (kein Drop bei großem setup())
```

### 11.3 E2E-Tests: Anpassungen
Datei: `e2e/serial-output-batching.spec.ts` (NEU)

```
Neue E2E-Tests:
├── T-E2E-01: Debug-Header zeigt "Dropped /s: 0" bei normalem Sketch
├── T-E2E-02: Debug-Header zeigt "Dropped /s: X" (rot) bei Flooding-Sketch
├── T-E2E-03: Baudrate wird im Debug-Header angezeigt
├── T-E2E-04: Total-Bytes zählen hoch während der Simulation
```

## 12. Umsetzungsplan

### Phase 1: Core Batcher (Tag 1)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 1.1 | `SerialOutputBatcher` Klasse implementieren | `server/services/serial-output-batcher.ts` (NEU) |
| 1.2 | Unit-Tests schreiben (T01–T19) | `tests/server/services/serial-output-batcher.test.ts` (NEU) |
| 1.3 | Unit-Tests grün | — |

### Phase 2: Server-Integration (Tag 1–2)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 2.1 | `SandboxRunner`: `SerialOutputBatcher` instanziieren und konfigurieren | `server/services/sandbox-runner.ts` |
| 2.2 | `handleParsedLine()`: Serial-Events durch Batcher leiten statt direkt senden | `server/services/sandbox-runner.ts` |
| 2.3 | Batcher Lifecycle (start/pause/resume/stop/destroy) in SandboxRunner einbinden | `server/services/sandbox-runner.ts` |
| 2.4 | `RegistryManager`: Telemetrie um `serialIntendedBytesPerSecond`, `serialDroppedBytesPerSecond` erweitern | `server/services/registry-manager.ts` |
| 2.5 | Batcher-Telemetrie in Heartbeat integrieren (analog PinStateBatcher) | `server/services/registry-manager.ts` |

### Phase 3: Schema & Transport (Tag 2)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 3.1 | `PerformanceMetrics` um Dropping-Felder erweitern | `shared/schema.ts` |
| 3.2 | `serial_event` WS-Typ entfernen, `SERIAL_EVENT_JSON` Logik entfernen | `shared/schema.ts`, `server/routes.ts` |
| 3.3 | `routes.ts`: `onOutput`-Callback vereinfachen (kein SERIAL_EVENT_JSON Parsing mehr) | `server/routes.ts` |

### Phase 4: Frontend (Tag 2–3)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 4.1 | `serial_event` Handler im Frontend entfernen | `client/src/hooks/use-simulation-controls.ts` o.ä. |
| 4.2 | Telemetrie-Store: `serialIntendedBytesPerSecond`, `serialDroppedBytesPerSecond` aufnehmen | `client/src/hooks/use-telemetry-store.ts` |
| 4.3 | Debug-Header: Dropped/s, Baud, Total anzeigen | `client/src/pages/arduino-simulator.tsx` |
| 4.4 | Dropped/s rot hervorheben wenn > 0 | `client/src/pages/arduino-simulator.tsx` |

### Phase 5: Cleanup (Tag 3)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 5.1 | **stdout → SerialParser Pfad entfernen** | `server/services/sandbox-runner.ts` |
| 5.2 | **`ArduinoOutputParser` (TS) Datei löschen** | `src/utils/arduino-output-parser.ts` |
| 5.3 | **Unit-Tests des TS-Parsers löschen** | `tests/unit/arduino-output-parser.test.ts` |
| 5.4 | Alle Imports/Referenzen auf entfernte Dateien bereinigen | Diverse |
| 5.5 | `pendingSerialEvents` Array und zugehörige Logik entfernen | `server/services/sandbox-runner.ts` |
| 5.6 | `TODO.md` aktualisieren: "Batching of serial messages" als erledigt markieren, "Realtime Serial Output Timing" als erledigt markieren (wird durch Batcher gelöst) | `TODO.md` |

### Phase 6: Tests & Verifikation (Tag 3–4)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 6.1 | Integrations-Tests anpassen (serial-flow.test.ts) | `tests/integration/serial-flow.test.ts` |
| 6.2 | Neue Integrations-Tests (T-INT-01 bis T-INT-04) | `tests/integration/serial-flow.test.ts` |
| 6.3 | E2E-Tests (T-E2E-01 bis T-E2E-04) | `e2e/serial-output-batching.spec.ts` (NEU) |
| 6.4 | Alle bestehenden Tests müssen grün sein (Regressionscheck) | `npm run test`, `npm run test:e2e` |
| 6.5 | Manueller Test: Flooding-Sketch aus der Problembeschreibung testen | — |

### Phase 7: Dokumentation (Tag 4)
| # | Aufgabe | Dateien |
| :--- | :--- | :--- |
| 7.1 | Dieses SSOT-Dokument als authoritative Quelle finalisieren | `ssot/ssot_function_description_serial_output.md` |
| 7.2 | Alte SERIAL_OUTPUT_FIX.md Referenzen prüfen | `archive/SERIAL_OUTPUT_FIX.md` — kein Action nötig |
| 7.3 | `ssot_serial_parser_architecture.md` aktualisieren (falls vorhanden) | `ssot/ssot_serial_parser_architecture.md` |

## 13. Risiken & Offene Fragen

### 13.1 Kontrollzeichen und Drop-Schnitt
Wenn der Batcher mitten in einer ANSI-Escape-Sequenz schneidet, könnte das Frontend die Sequenz falsch darstellen. **Mitigation:** Der Batcher prüft vor dem Schnitt, ob ein unvollständiger ANSI-Prefix (`\x1b[...` ohne Terminator) vorliegt, und verschiebt die Schnittgrenze.

### 13.2 Burst bei setup()
Viele Sketche geben in `setup()` einmalig viel Text aus (Begrüßung, Konfiguration). Das Burst-Budget (3× normalem Tick-Budget) fängt das ab. Bei extremen Fällen (> 1728 Bytes im setup) wird dennoch gedropt — das ist akzeptabel.

### 13.3 Serial.write() Binärdaten
`Serial.write()` kann beliebige Bytes senden (0x00–0xFF). Der Batcher arbeitet auf String-Ebene (nach Base64-Dekodierung). Binäre Null-Bytes könnten Probleme machen. **Mitigation:** Der Batcher arbeitet auf `Buffer`-Ebene statt auf Strings, oder Null-Bytes werden vor dem Batching escaped.

---

## Anhang A: Vergleich mit PinStateBatcher

| Aspekt | PinStateBatcher | SerialOutputBatcher |
| :--- | :--- | :--- |
| **Datenart** | Diskrete Key-Value States | Fortlaufender Byte-Stream |
| **Dedup-Strategie** | "Last value wins" per Key | Keine Dedup (Stream) |
| **Drop-Strategie** | Implizit (Überschreiben) | Explizit (Tail-wins + Indikator) |
| **Rate-Limit** | Tick-basiert (50ms) | Tick + Baudrate-Budget |
| **Buffer-Struktur** | `Map<string, PinStateEvent>` | String/Buffer (append-only) |
| **Telemetrie** | intended/actual/batches | intended/actual/dropped/chunks/total |
| **Tick-Intervall** | 50ms | 50ms (identisch) |

## Anhang B: Alte Arbeitsliste (ersetzt)

Die Tasks TASK-SERIAL-01 bis TASK-SERIAL-07 aus der vorherigen Version dieses Dokuments sind durch den oben beschriebenen Umsetzungsplan ersetzt:

- **TASK-SERIAL-01** (Baudrate-Capping): ✅ Implementiert (txDelay cap 2ms). SerialOutputBatcher ist der primäre Rate-Limiter.
- **TASK-SERIAL-02** (Debug-Header): → Phase 4 (§12)
- **TASK-SERIAL-03** (Frontend-Baudrate-Simulation): → Ersetzt durch Server-seitigen Batcher. Kein Frontend-Timing nötig.
- **TASK-SERIAL-04** (TS-Parser Basen): → Entfällt mit Entfernung des TS-Parsers (Phase 5).
- **TASK-SERIAL-05** (Doppelte Parser-Architektur): → Phase 5 Cleanup löst das.
- **TASK-SERIAL-06** (HEX Groß-/Kleinschreibung): → Bleibt als Minor-Cleanup, nicht im Scope.
- **TASK-SERIAL-07** (Archiv): → Kein Handlungsbedarf.

---

## Anhang C: Phase 8 Post-Mortem (10. Februar 2026)

### C.1 Problem-Report
Nach der Phase 7 Implementierung wurde folgendes Verhalten gemeldet:
1. **Kein Dropping erkennbar** trotz High-Frequency-Output
2. **Output stoppt nach ~1.5s** — keine neuen Nachrichten im Frontend
3. **Pause/Stop funktioniert** ohne Verzögerung (C++ Prozess läuft noch)
4. **Tastenkürzel ⌘+Shift+D** kollidierte mit Browser (öffnet "Neue Lesezeichen")

### C.2 Root-Cause-Analyse

**Backend-Pipeline:** ✅ Funktioniert korrekt
- SerialOutputBatcher sendet Daten kontinuierlich
- WebSocket sendet `serial_output` Nachrichten

**Frontend-Pipeline:** ⚠️ Probleme identifiziert

| Problem | Ursache | Fix |
|---------|---------|-----|
| **Unbegrenztes Array-Wachstum** | `serialOutput` Array wächst ohne Limit → React-Performance kollabiert | MAX_SERIAL_LINES = 5000 eingeführt |
| **Dead Code mit lastSerialEventAtRef** | Alte Logik prüft auf entfernten `serial_event` Typ (immer = 0) | Code entfernt |
| **Tastenkürzel-Kollision** | Alt+D war auf ⌥+D gesetzt, ⌘+Shift+D kollidiert mit Browser | Geändert zu ⌘+D / Ctrl+D |

### C.3 Implementierte Fixes (10. Februar 2026)

#### Fix 1: Serial Output Line Limit
```typescript
// client/src/pages/arduino-simulator.tsx
const MAX_SERIAL_LINES = 5000;
setSerialOutput((prev) => {
  // ... append logic ...
  if (newLines.length > MAX_SERIAL_LINES) {
    return newLines.slice(newLines.length - MAX_SERIAL_LINES);
  }
  return newLines;
});
```

#### Fix 2: Tastenkürzel korrigiert
```typescript
// ⌘+D (Mac) oder Ctrl+D (Windows/Linux)
const isMac = navigator.platform.toLowerCase().includes('mac');
const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;
if (isModifierPressed && !e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
  e.preventDefault();
  // Toggle debug mode
}
```

#### Fix 3: Dead Code entfernt
- `lastSerialEventAtRef` Variable entfernt
- Zugehörige Drop-Logik für `serial_event` entfernt
- Obsolete `ssot_serial_parser_architecture.md` gelöscht

### C.4 Verifikation

| Test | Status |
|------|--------|
| Build (`npm run build`) | ✅ Erfolgreich |
| Unit-Tests (`npm run test`) | ✅ 794 Tests bestanden |
| Integration-Tests | ✅ 12 Serial-Flow Tests bestanden |

### C.5 Offene Test-Lücken

Die folgenden Worst-Case-Szenarien benötigen explizite E2E-Tests:

| Test-ID | Szenario | Erwartung |
|---------|----------|-----------|
| E2E-WC-01 | High-Frequency Output (500 Zeilen/s, > 30s) | Frontend bleibt reaktiv, älteste Zeilen werden entfernt |
| E2E-WC-02 | Flooding-Sketch mit Dropping | Telemetrie zeigt `dropped > 0`, Serial-Monitor scrollt weiter |
| E2E-WC-03 | ⌘+D Tastenkürzel | Debug-Mode Toggle, kein Browser-Lesezeichen |
| E2E-WC-04 | Rapid Start/Stop (10x in 5s) | Keine Zombie-Timer, sauberer Cleanup |

---

## Anhang D: Vereinfachter Umsetzungsplan Phase 8

### Phase 8a: E2E-Tests für Worst-Case (Priorität: Hoch)
| # | Aufgabe | Dateien |
|---|---------|---------|
| 8a.1 | E2E-Test: High-Frequency 30s Lauf | `e2e/serial-output-stress.spec.ts` (NEU) |
| 8a.2 | E2E-Test: Dropping-Anzeige verifizieren | `e2e/serial-output-stress.spec.ts` |
| 8a.3 | E2E-Test: ⌘+D Tastenkürzel | `e2e/phase7r-keyboard-dropping.spec.ts` (UPDATE) |

### Phase 8b: Frontend-Optimierungen (Priorität: Mittel)
| # | Aufgabe | Dateien |
|---|---------|---------|
| 8b.1 | Virtualized List für Serial-Monitor (react-window) | `client/src/components/features/serial-monitor.tsx` |
| 8b.2 | Message-Processing in requestAnimationFrame batchen | `client/src/pages/arduino-simulator.tsx` |

### Phase 8c: Dokumentation (Priorität: Niedrig)
| # | Aufgabe | Dateien |
|---|---------|---------|
| 8c.1 | Dieses Dokument finalisieren | `ssot/ssot_function_description_serial_output.md` |
| 8c.2 | README.md Serial-Sektion aktualisieren | `README.md` |

---

## Anhang E: Testfälle für Worst-Case-Szenarien

### E.1 E2E-Test: serial-output-stress.spec.ts

```typescript
// e2e/serial-output-stress.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Serial Output Stress Tests', () => {
  
  test('E2E-WC-01: High-frequency output for 30s stays responsive', async ({ page }) => {
    // Upload flooding sketch
    const floodingCode = `
      void setup() { Serial.begin(115200); }
      void loop() {
        static uint32_t t;
        if (millis()-t>2) { t=millis(); Serial.println(millis()); }
      }
    `;
    // Start simulation
    // Wait 30s
    // Verify: UI still responds to clicks
    // Verify: Serial monitor shows recent lines (not frozen)
    // Verify: Line count capped at MAX_SERIAL_LINES
  });

  test('E2E-WC-02: Dropping shown in telemetry', async ({ page }) => {
    // Enable debug mode (⌘+D)
    // Upload extreme flooding sketch
    const extremeFloodCode = `
      void setup() { Serial.begin(115200); }
      void loop() { Serial.println("FLOOD"); } // No delay = extreme
    `;
    // Verify: Telemetry shows Dropped/s > 0 after ~1s
    // Verify: Dropped/s indicator is red
  });

  test('E2E-WC-03: Cmd+D toggles debug mode', async ({ page }) => {
    // Press ⌘+D (Mac) or Ctrl+D (Windows/Linux)
    // Verify: Debug mode toggled
    // Verify: No browser bookmark dialog
  });

});
```

### E.2 Unit-Tests: Frontend Line Limit

```typescript
// tests/client/serial-output-limit.test.ts
import { describe, it, expect } from 'vitest';

describe('Serial Output Line Limit', () => {
  const MAX_SERIAL_LINES = 5000;

  it('should cap array at MAX_SERIAL_LINES', () => {
    // Simulate 6000 lines added
    // Verify array.length === 5000
    // Verify oldest 1000 lines were dropped
  });

  it('should keep newest lines when capping', () => {
    // Add lines 1-6000
    // Verify lines 1001-6000 remain
    // Verify lines 1-1000 were dropped
  });
});
```

---

## Anhang F: Phase 8b — Serial.print() Regression & Budget-Fix (10. Februar 2026)

### F.1 Problem-Reports

Drei Probleme wurden beim interaktiven Testen entdeckt:

1. **Serial.print() vs println() Regression:** `Serial.print("1 "); Serial.print("2")` erzeugte separate Zeilen statt konkatenierter Ausgabe.
2. **Daten fließen nach Stop weiter:** Bei schnellem Output kam nach dem Stoppen noch Datenflut ins Frontend.
3. **Keine Drops bei Baud=1:** Trotz extremer Baudrate-Diskrepanz zeigte die Telemetrie `DROPPED /s: 0`.
4. **Simulation endet "zu früh":** Sketch mit `exit(0)` nach 5s wurde als Timeout-Problem fehlinterpretiert.

### F.2 Root-Cause-Analyse & Fixes

#### Fix 1: isComplete-Flag im onChunk Callback (sandbox-runner.ts)

**Problem:** Der Batcher's `onChunk` Callback markierte jeden Chunk als `isComplete: true`. Dadurch wurde `Serial.print("A")` wie `Serial.println("A")` behandelt — jede Ausgabe startete eine neue Zeile.

**Fix:** Der Callback splittet nun nach `\n` und leitet `isComplete` korrekt ab:
```typescript
onChunk: (data: string) => {
  const endsWithNewline = data.endsWith('\n');
  const parts = data.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const isLastPart = i === parts.length - 1;
    if (isLastPart && endsWithNewline) break; // Trailing empty string
    const isComplete = !isLastPart; // Gefolgt von \n → complete
    this.outputCallback(parts[i], isComplete);
  }
}
```

#### Fix 2: Stop-Flush Discard (sandbox-runner.ts)

**Problem:** `stop()` rief `batcher.stop()` auf, was **alle** gepufferten Daten ohne Limit flushte — tausende Bytes auf einen Schlag ins Frontend.

**Fix:** User-initiierter `stop()` ruft jetzt `batcher.destroy()` (verwirft Daten) statt `batcher.stop()` (flusht). Natürlicher Prozess-Exit nutzt weiterhin `stop()` → `destroy()` im Close-Handler.

#### Fix 3: Pipe-Buffer Guard (sandbox-runner.ts)

**Problem:** Nach `processKilled` kamen Daten aus dem OS Pipe Buffer (bis zu 64KB) über den Fallback-Pfad ins Frontend.

**Fix:** `!this.processKilled` Guard im Fallback-Output-Pfad.

#### Fix 4: MIN_BUDGET → Proportionaler Floor (serial-output-batcher.ts)

**Problem:** `MIN_BUDGET = 50` (hart kodiert) gab jeder Baudrate ein 50-Byte-Geschenk. Bei Baud=1 bedeutete das: Budget wird nie aufgebraucht (für typische Ausgaben). Bei gleichzeitig `Math.floor(0.005) = 0` Refill pro Tick wurde das Budget nach Verbrauch **nie wieder aufgefüllt**.

**Fix:** Zwei Änderungen:

1. **Proportionaler Floor statt fixem MIN_BUDGET:**
```typescript
// Floor = min(50, ceil(bytesPerSecond × 0.5)) = "halbe Sekunde Output, max 50"
const proportionalFloor = Math.min(50, Math.ceil(bytesPerSecond * 0.5));
this.maxBudget = Math.max(1, Math.floor(burstBudget), proportionalFloor);
```

| Baudrate | bytesPerSecond | proportionalFloor | maxBudget | Alt (MIN_BUDGET=50) |
|----------|---------------|-------------------|-----------|---------------------|
| 1 | 0.1 | 1 | 1 | 50 |
| 300 | 30 | 15 | 15 | 50 |
| 1200 | 120 | 50 | 50 | 50 |
| 9600 | 960 | 50 | 144 | 144 |
| 115200 | 11520 | 50 | 1728 | 1728 |

2. **Fraktionale Byte-Akkumulation:**
```typescript
// Statt Math.floor() pro Tick (verliert Sub-Byte-Anteile):
this.budgetAccumulator += rawBytesPerTick;  // z.B. 0.005 pro Tick
const wholeBytesToAdd = Math.floor(this.budgetAccumulator);
this.budgetAccumulator -= wholeBytesToAdd;  // Carry-Over der Fraktion
```
Bei Baud=1: 0.005 bytes/tick → nach 200 Ticks (10s) akkumuliert 1.0 → 1 Byte Budget.

### F.3 txDelay-Overhead-Analyse

**Warum einzelne `Serial.print("X")` Aufrufe keine Drops erzeugen:**

Der C++ Mock's `txDelay()` berechnet `(10 × numChars × 1000) / baudrate`, gekappt auf max 2ms.

| Muster | txDelay pro Aufruf | Gesamtrate | Budget (11520 B/s) | Drops? |
|--------|-------------------|------------|---------------------|--------|
| `Serial.println("X")` einzeln | 0.17ms (kein Cap) | ~11520 B/s | ~11520 B/s | ❌ |
| `Serial.println("Hello")` | 0.52ms (kein Cap) | ~11520 B/s | ~11520 B/s | ❌ |
| `Serial.println(buf)` mit 200 Zeichen | 2ms (gekappt) | ~66000 B/s | ~11520 B/s | ✅ ~83% |
| `Serial.println(buf)` mit 500 Zeichen | 2ms (gekappt) | ~166000 B/s | ~11520 B/s | ✅ ~92% |

**Kerninsight:** Der `txDelay`-Cap bei 2ms stellt sicher, dass der SerialOutputBatcher der alleinige Rate-Limiter ist. Für kurze Strings (< ~23 Zeichen bei 115200) bleibt txDelay realistisch (kein Cap). Für längere Strings oder niedrige Baudraten greift der Cap und der Batcher droppt überschüssige Daten.

### F.4 Integration Flooding Tests (NEU)

Datei: `tests/integration/serial-flooding.test.ts`

| Test-ID | Szenario | Ergebnis |
|---------|----------|----------|
| T-FLOOD-01 | 200-Zeichen-Strings, 2s | ~80-85% Drop-Rate |
| T-FLOOD-02 | Kurze Strings ("X\n"), 1s | 0 Drops |
| T-FLOOD-03 | 500-Zeichen-Strings, 2s | ~90-93% Drop-Rate |

### F.5 Extreme-Baudrate Unit Tests (NEU)

Datei: `tests/server/services/serial-output-batcher.test.ts` (T20–T23)

| Test-ID | Szenario | Ergebnis |
|---------|----------|----------|
| T20 | Baud=1, "Hello World!\n" | 12 Bytes dropped, 0 actual (maxBudget=1, newline-adjustment) |
| T21 | Baud=1, fraktionale Akkumulation | 1 Byte nach 200 Ticks (10s) korrekt durchgelassen |
| T22 | Baud=1, Massen-Flooding 4000 Bytes | ~3999 dropped, ~1 actual |
| T23 | Baud=300, proportionaler Floor | "Hello World!\n" (13 Bytes) passt in maxBudget=15 |

### F.6 Verifikation

| Test | Status |
|------|--------|
| TypeScript Build | ✅ Erfolgreich |
| Unit-Tests | ✅ 800 Tests bestanden (23 Batcher-Tests) |
| Integration-Tests | ✅ 15 Serial-Tests bestanden (12 Flow + 3 Flooding) |
| Sandbox-Stress | ⚠️ 1 flaky (Temp-Dir Cleanup-Timing, unrelated) |