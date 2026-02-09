# Funktionsbeschreibung: Serieller Output-Stream (Arduino Sandbox)

## 1. Übersicht
Das System emuliert die serielle Schnittstelle eines Arduino-Sketches. Es fängt die Standardausgabe des kompilierten C++ Programms ab, formatiert sie gemäß den Arduino-Regeln und streamt sie in Echtzeit an das Frontend.

## 2. Datentyp-Konvertierung (Print-Klasse)
Der Simulator bildet das Verhalten der Arduino-`Print`-Bibliothek ab. Die Konvertierung erfolgt serverseitig im C++ Mock (`arduino-mock.ts`):

| Datentyp | Transformation | Beispiel |
| :--- | :--- | :--- |
| **Integer** | Dezimal-String (Standard). | `101` -> `"101"` |
| **Integer + Base** | Umwandlung in beliebige Basis ≥ 2 (BIN, OCT, HEX oder andere). | `(78, HEX)` -> `"4E"`, `(255, 3)` -> `"100110"` |
| **Integer + Base < 2** | Fallback auf Dezimal (analog Arduino). | `(42, 1)` -> `"42"` |
| **Float** | Standardmäßig 2 Nachkommastellen (gerundet). | `3.1415` -> `"3.14"` |
| **Float + Prec** | Spezifizierte Nachkommastellen. | `(1.234, 3)` -> `"1.234"` |
| **Boolean** | Konvertierung in "1" oder "0". | `true` -> `"1"` |
| **byte** | Als Integer ausgegeben (nicht als ASCII-Char). | `byte(65)` -> `"65"` |

### 2.1 Serial.write() vs Serial.print()
- **`Serial.write()`**: Sendet rohe Bytes — geht durch dieselbe `serialWrite()`/`SERIAL_EVENT`-Pipeline wie `print()`.
- **`Serial.print()`**: Konvertiert Werte in ASCII-Darstellung und sendet diese.

## 3. Transport-Protokoll
Alle Ausgaben (print, println, write) werden über **stderr** als base64-kodierte `SERIAL_EVENT`-Nachrichten gesendet:
```
[[SERIAL_EVENT:<millis_timestamp>:<base64_data>]]
```
Der Server dekodiert diese und leitet sie über WebSocket an das Frontend.

## 4. Streaming- & Buffer-Strategie
Um eine flüssige Darstellung im Frontend zu gewährleisten, wird eine **zeitbasierte Chunk-Logik** implementiert:

* **Buffer-Mechanismus:** Empfangene Bytes werden in einem flüchtigen Speicher gesammelt.
* **Immediate Flush:** Daten werden sofort gesendet, wenn ein Newline (`\n`) erkannt wird.
* **Pre-Flush bei Steuerzeichen:** Bei `\b` (Backspace) oder `\r` (Carriage Return) wird der Buffer **vor** dem Steuerzeichen geflusht, damit es mit dem folgenden Content zusammenbleibt.
* **Timed Flush (TS-Parser):** Wenn kein Newline empfangen wird, wird der Buffer nach spätestens **20ms** automatisch geleert und gesendet (ermöglicht die Darstellung der "Drei Punkte" `...`).
* **Setup/Loop-Persistenz:** Der Stream-Kontext bleibt beim Übergang von `setup()` zu `loop()` vollständig erhalten.

## 5. Steuerzeichen & Interpretation
Das Backend fungiert als transparenter Proxy für Steuerzeichen. Die Interpretation erfolgt im Frontend (SerialMonitor-Komponente).
- **CR/LF:** Standard Zeilensteuerung.
- **Backspace (`\b`):** Wird als RAW-Byte weitergegeben, damit das Frontend den Cursor bewegen kann.
- **ANSI Escape Sequences:** Werden für farbige Ausgaben oder Positionierung unterstützt.

## 6. Baudraten-Simulation

### 6.1 Aktuelle Implementierung (Backend)
Die Baudrate wird **serverseitig** im C++ Mock simuliert via `txDelay()`:
- Nach jedem `flushLineBuffer()` wird `txDelay(numChars)` aufgerufen.
- Formel: `totalMs = (10 bits × numChars × 1000) / baudrate`
- Bei 115200 Baud (empfohlen): < 1ms pro 100 Zeichen — vernachlässigbar.
- Bei 9600 Baud: ~104ms pro 100 Zeichen — spürbar.
- Bei 300 Baud: ~3,3 Sekunden pro 100 Zeichen — **Simulation wird unbrauchbar langsam**.

### 6.2 Designentscheidung
- Der `code-parser.ts` erzwingt `Serial.begin(115200)` und warnt bei anderen Baudraten.
- **Offener Punkt:** Das SSOT sah ursprünglich eine reine Frontend-Simulation vor ("visueller Effekt"). Die aktuelle Implementierung simuliert die Baudrate im Backend via `sleep()`. Beides hat Vor- und Nachteile:
  - **Backend-Simulation (aktuell):** Realistischer Timing-Effekt, aber blockiert den Prozess bei niedrigen Baudraten.
  - **Frontend-Simulation (Alternative):** Kein Blocking, aber weniger realistisch bei parallelen Serial-Ausgaben.
- **Empfehlung:** Bei 115200 Baud ist der Backend-Delay vernachlässigbar. Für niedrigere Baudraten sollte ein Capping implementiert werden (z.B. max. 10ms Delay pro Flush), damit die Simulation nicht einfriert.

## 7. Debug-Mode: Telemetrie im Serial-Header
Im Debug-Mode wird die Telemetrie-Information `serialOutputPerSecond` im Header des Serial-Output-Panels angezeigt (analog zur SVG-Telemetrie im Board-Header):

### 7.1 Aktuell implementiert
- **Serial Output /s**: Zeigt die aktuelle Rate der seriellen Ausgaben pro Sekunde an.
- Wird nur im Debug-Mode (`debugMode === true`) und bei laufender Simulation (`simulationStatus === "running"`) angezeigt.

### 7.2 Geplante Erweiterungen (Debug-Header)
Folgende Telemetrie-Daten sollten zusätzlich im Serial-Header angezeigt werden:
- **Buffer-Größe**: Anzahl gepufferter Bytes im TS-Parser.
- **Baudrate**: Aktuelle konfigurierte Baudrate.
- **Bytes gesamt**: Kumulative Bytes seit Sketch-Start.
- **Chunks /s**: Anzahl gesendeter Chunks pro Sekunde (vs. Bytes/s).
- **Latenz**: Durchschnittliche Latenz vom C++ `millis()` zum Frontend-Empfang.

---

## 8. Arbeitsliste für Folge-Agenten

Folgende Aufgaben sind identifiziert, priorisiert und so formuliert, dass sie von einem einzelnen Agenten abgearbeitet werden können:

### 8.1 Hohe Priorität

**TASK-SERIAL-01: Baudrate-Capping im C++ Mock implementieren**
- **Datei:** `server/mocks/arduino-mock.ts`, Funktion `txDelay()`
- **Problem:** Bei niedrigen Baudraten (z.B. 300) blockiert `txDelay()` den Prozess sekundenlang.
- **Lösung:** `totalMs` auf max. 10ms begrenzen: `totalMs = std::min(totalMs, 10L);`
- **Tests:** Integrationstest hinzufügen, der bei `Serial.begin(300)` prüft, dass die Ausgabe trotzdem in < 2s erscheint.
- **Aufwand:** Klein (1 Zeile Code + 1 Test)

**TASK-SERIAL-02: Debug-Header um Baudrate und Bytes-gesamt erweitern**
- **Datei:** `client/src/pages/arduino-simulator.tsx` (Serial-Header, ca. Zeile 2385–2405)
- **Datei:** `client/src/hooks/use-telemetry-store.ts` (ggf. neues Feld `serialBytesTotal`)
- **Vorbild:** Die bestehende `serialOutputPerSecond`-Anzeige im Serial-Header.
- **Umsetzung:** Neben "Serial Output X.X /s" noch "Baud: 115200" und "Total: XXX B" anzeigen.
- **Datenquelle:** `baudrate` kommt aus der IO-Registry, `bytesTotal` muss im Telemetrie-Store akkumuliert werden.
- **Aufwand:** Mittel (UI + Store-Erweiterung)

### 8.2 Mittlere Priorität

**TASK-SERIAL-03: Frontend-Baudraten-Simulation (visueller Effekt)**
- **Kontext:** Das bestehende TODO in `TODO.md` beschreibt dies unter "Realtime Serial Output Timing".
- **Dateien:** `client/src/components/features/serial-monitor.tsx`
- **Umsetzung:** `ts_write` aus SERIAL_EVENT_JSON nutzen, Zeichen verzögert in den DOM rendern basierend auf `(10 × chars × 1000) / baudrate`.
- **Toggle:** "Fast Mode" Button im Serial-Header, der die Verzögerung deaktiviert.
- **Aufwand:** Mittel-Groß (Timer-Queue im Frontend, DOM-Performance)

**TASK-SERIAL-04: TS-Parser ArduinoOutputParser um beliebige Basen erweitern**
- **Datei:** `src/utils/arduino-output-parser.ts`, Methode `print()`
- **Problem:** Der TS-Parser behandelt `print(255, 3)` falsch — er ignoriert den numerischen Modifier bei Integers und gibt Dezimal aus ("255" statt "100110").
- **Aktuelle Relevanz:** Gering, da der TS-Parser im Hauptpfad nur bereits formatierte Strings empfängt. Die Basis-Konvertierung passiert im C++ Mock.
- **Lösung:** Integer-Pfad erweitern: wenn `modifier` eine Zahl ≥ 2 ist, `value.toString(modifier)` verwenden.
- **Tests:** Schon vorhanden in `tests/unit/arduino-output-parser.test.ts` — Testerwartung anpassen.
- **Aufwand:** Klein (5 Zeilen Code + Test-Update)

### 8.3 Niedrige Priorität / Cleanup

**TASK-SERIAL-05: Doppelte Parser-Architektur dokumentieren/vereinfachen**
- **Problem:** Es gibt ZWEI Serial-Parser: den TS-Parser (`src/utils/arduino-output-parser.ts`) und den Server-Parser (`server/services/arduino-output-parser.ts`). Der TS-Parser ist im aktuellen Architekturpfad redundant, da alle Serial-Daten als SERIAL_EVENT über stderr kommen und vom Server-Parser verarbeitet werden.
- **Prüfen:** Wird der TS-Parser `serialParser` in `sandbox-runner.ts` noch für stdout-Daten genutzt? Falls ja, dokumentieren. Falls nicht, entfernen oder als reinen Frontend-Formatter umwidmen.
- **Aufwand:** Mittel (Analyse + ggf. Refactoring)

**TASK-SERIAL-06: HEX-Ausgabe Groß-/Kleinschreibung vereinheitlichen**
- **Problem:** Der C++ Mock gibt HEX jetzt uppercase aus (`FF`). Der Integrationstest verwendet `.toLowerCase()` zur Prüfung. Arduino gibt ebenfalls uppercase aus. Prüfen, ob Frontend-Darstellung konsistent ist.
- **Aufwand:** Klein (Verifizierung + ggf. Testkorrektur)

**TASK-SERIAL-07: `SERIAL_OUTPUT_FIX.md` ins Archiv verschieben**
- **Datei:** `archive/SERIAL_OUTPUT_FIX.md`
- **Status:** Bereits im Archiv, enthält veraltete Details zur Race Condition. Kein Handlungsbedarf, da die Fixes im Code und in den Tests dokumentiert sind.
- **Aufwand:** Keine Aktion nötig