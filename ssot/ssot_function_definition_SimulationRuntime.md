# Funktionsbeschreibung: Simulations-Laufzeit (Emulationskern)

Status: current  
Zielrolle: feature-contract  
Ziel-SSOT für die Laufzeit des Emulationskerns `@unosim/avr-emulator`: Diagnosen und ihre Grenzen sowie Befehle und Ereignisse zwischen UI und Worker, Worker-Host und Headless-Lauf. Zeitmodell, Speichermodell, Überwachung des Workers und Modellannahmen kommen mit den Paketen P3.1 und P3.2 des [Umsetzungsplans](../docs/proposals/browser-emulation-plan.md) hinzu. Der Plan ist nicht normativ; dieses Dokument gilt für das, was der Code umsetzt.

## Governance-Grenzen

- Das Dokument beschreibt Verhalten des Pakets `packages/avr-emulator/`. Das Paket importiert nichts aus UnoSim.
- Die Anzeige der Diagnosen (Systemzeile, Debug-Konsole) und ihre Texte gehören zur UI und zu `docs/USER_GUIDE.md`; das Paket liefert strukturierte Ereignisse.
- Tests ergänzen `docs/TESTING_STANDARDS.md`.

## 1. Diagnosen

Der Emulator meldet genau fünf Fälle. Abruf: `emulator.takeDiagnostics()` liefert die Ereignisse seit dem letzten Aufruf, jedes mit `kind`, den Angaben des Falls und `simTimeMs`.

| `kind` | Bedingung | Angaben |
|---|---|---|
| `stack-overflow` | SP liegt unter `__bss_end` (`region: "bss"`) oder, falls `malloc` gelinkt ist und `__brkval` ungleich 0 ist, unter `__brkval` (`region: "heap"`) | `sp`, `limit` (Datenraumadressen) |
| `pc-out-of-program` | PC liegt hinter dem letzten programmierten Wort des Abbilds (gelöschter Flash) | `pc`, `programBytes` (Byteadressen) |
| `watchdog-reset` | Der Watchdog löst einen Reset aus (WDE gesetzt, WDIE nicht) | – |
| `sleep-interrupts-disabled` | `SLEEP` wird bei gesetztem SE-Bit und gelöschtem globalem Interrupt-Flag ausgeführt | `pc` (Byteadresse) |
| `serial-input-discarded` | Serielle Eingabe traf ein, während der USART-Empfänger aus war (vor `Serial.begin()` oder nach `Serial.end()`); die Bytes sind verloren, wie am echten Uno | `port`, `bytes` (Anzahl der verworfenen Bytes der Lage) |

### 1.1 Zeitpunkt der Prüfung

- Stack und PC werden am Ende jedes Rechenabschnitts (4000 Takte) geprüft; der Stack zusätzlich bei jedem Schreibzugriff auf SPL.
- `PUSH`, `CALL` und Interrupts ändern SP in avr8js ohne Hook. **Ein Überlauf, der vor der nächsten Prüfung zurückgeht, bleibt unerkannt.**
- `SLEEP` wird nur geprüft, solange das SE-Bit gesetzt ist (davor ist `SLEEP` wirkungslos).
- Ohne das Symbol `__bss_end` im ELF des Abbilds entfällt die Stack-Prüfung. `__brkval` fehlt, solange `malloc` nicht gelinkt ist; dann gilt nur `.bss`.

### 1.2 Wiederholung

Eine Bedingung wird einmal gemeldet und erst wieder, nachdem sie geendet hat (Stack über der Grenze, PC im Programm, SE gelöscht). Ein Watchdog-Reset wird bei jedem Reset erkannt. Gleiche Diagnosen desselben Laufs erscheinen höchstens einmal je simulierter Sekunde. Ausnahme `serial-input-discarded`: einmal je Lage und Port, erneut erst nachdem der Empfänger zwischendurch aktiv war (nie je Byte, nie als Serial-Ausgabe). Sinngemäße Anzeige: „Serielle Eingabe verworfen, weil der Empfänger noch nicht aktiv war (`Serial.begin()` ist noch nicht gelaufen).“

### 1.3 Watchdog-Reset

avr8js setzt beim Watchdog-Reset nur PC und SP zurück. Der Emulator baut deshalb, wie bei der RESET-Taste, eine neue Maschine aus demselben Abbild auf: EEPROM, äußere Pegel und Spannungen bleiben, Seriell-Eingaben, die noch nicht empfangen wurden, gehen verloren. Die simulierte Zeit läuft weiter.

### 1.4 Nicht erkannt

Schreibzugriffe über Arraygrenzen, Zugriffe auf freigegebenen Speicher, Heap-Fragmentierung und Zeiger, die in I/O-Register schreiben, wirken wie am echten Board und werden nicht gemeldet. `SLEEP` hält die CPU in der Simulation nicht an (avr8js setzt den Befehl nicht um); die Diagnose nennt nur den Fall mit gesperrten Interrupts.

## 2. Befehle und Ereignisse (Worker ↔ UI)

Typen: `Command`, `WorkerEvent`, `RunEvent` in `packages/avr-emulator/src/protocol/messages.ts`; Protokollversion `PROTOCOL_VERSION = 1` (steht in `ready`). Das Paket enthält die Typen, die Prüfung eingehender Befehle, die Bündelung und die UI-seitige Laufverwaltung; der Worker selbst (P1.12) und die Überwachung von außen (P3.2) setzen darauf auf.

### 2.1 Laufkennung

Der Hauptthread vergibt eine aufsteigende `runId` (`RunGate.runIdFor`). `load`, `start` und `reset` beginnen eine neue `runId`, alle übrigen Befehle tragen die aktuelle. Jedes Ereignis trägt die `runId` seines Laufs. `RunGate.accept` verwirft Ereignisse mit anderer `runId`; `RunGate.end()` (stop) beendet den Lauf in der UI sofort, spätere Ereignisse des Laufs fallen weg. Der Zustand `running`/`paused` gilt in der UI erst mit der `status`-Bestätigung zur aktuellen `runId`.

### 2.2 Befehle

| Befehl | Felder | Grenzen |
|---|---|---|
| `load` | `board` (gewählt), `artifactBoard`, `buildId`, `sha256`, `flash` (`ArrayBuffer`), `symbols` | bekannte Boards, `buildId` 1–256 Zeichen, `sha256` 64 Hexziffern, Flash 1 Byte bis 256 KiB |
| `start` | `timeoutMs` | 1000–300000 (1–300 s, E8) |
| `pause`, `resume`, `stop`, `reset` | – | – |
| `serialIn` | `port`, `text` | Port 0–3, 1 bis 4096 Byte UTF-8 |
| `setDigital` | `pin`, `level` | Pin 0–255, Pegel 0 oder 1 |
| `setAnalog` | `pin`, `value` | Pin 0–255, Wert 0–1023 ganzzahlig |

`parseCommand` prüft jede eingehende Nachricht; unbekannte Typen, fehlende oder falsche Felder und Werte außerhalb der Grenzen werden verworfen. Unbekannte Zusatzfelder werden ignoriert. Ob ein Pin zum Board gehört, prüft der Host.

### 2.3 Ereignisse

`ready` (Protokollversion, Board, `buildId`), `heartbeat` (simulierte Zeit), `status` (`running`, `paused`, `stopped`, Grund), `serial` (Port, Text), `pins` (letzter Zustand je geänderter Pin, Zähler), `usage`, `telemetry`, `diagnostic` (Abschnitt 1), `fault`.

### 2.4 Bündelung (`EventBatcher`)

- Höchstens eine Gruppe je 1/60 s; was dazwischen anfällt, wartet und geht nicht verloren (außer durch die Grenzen unten).
- Pins: letzter Zustand je Pin, `changeCount` summiert. Serial: je Port zusammenhängender Text; Reihenfolge von Serial, Diagnosen und Status bleibt erhalten, Pins und `usage` folgen am Ende der Gruppe.
- Telemetrie höchstens einmal je Sekunde: simulierte Zeit, Echtzeitfaktor, Pin-Änderungen und Serial-Zeichen je Sekunde, verworfene Serial-Zeichen.
- Schutz der UI: Serial-Text, der über 256 Ki wartende Zeichen hinausgeht, wird verworfen und in `serialCharsDropped` gezählt; ein Serial-Ereignis trägt höchstens 32 Ki Zeichen; höchstens 1000 wartende Status- und Diagnoseeinträge.

## 3. Worker-Host

`WorkerHost` (`packages/avr-emulator/src/worker/host.ts`, Einstieg `@unosim/avr-emulator/worker`, Verdrahtung `installWorker`) setzt die Befehle um. Er bleibt zwischen Läufen bestehen; `load` ersetzt die Maschine.

- **Prüfung:** Jede Nachricht geht durch `parseCommand`. Ungültige Nachrichten und Befehle mit anderer `runId` als der des laufenden Laufs werden verworfen; `load`, `start` und `reset` müssen eine höhere `runId` tragen als die bisherige.
- **`load`:** Wegen `artifactBoard ≠ board` (Artefakt für ein anderes Board als das gewählte) oder bei ungültigem Abbild (Größe, SHA-256) antwortet der Host mit `fault` und `status stopped` (Grund `fault`). Sonst baut er die Maschine auf und sendet `ready`. Das Timeout gilt ab `start`.
- **Bestätigungen:** `start` und `resume` → `status running`; `pause` → `status paused`; `stop` → `status stopped` (Grund `stop`); `reset` → `status running` bzw. `paused`; Timeout und interne Fehler enden mit `status stopped` (Grund `timeout` bzw. `fault`, bei `fault` zusätzlich das Ereignis `fault`). Bestätigungen gehen sofort hinaus, `serialIn`, `setDigital` und `setAnalog` warten auf das reguläre Paketintervall.
- **Ende eines Laufs:** Vor `status stopped` werden alle noch wartenden Ausgaben gesendet; danach wird der Zustand verworfen. Ein ersetzter Lauf (`load`) meldet kein `stopped`.
- **Heartbeat:** etwa alle 500 ms, solange eine Maschine geladen ist, auch in der Pause.
- **Sammeln:** Alle 1/60 s holt der Host Pins, Serial-Ausgabe, `usage` und Diagnosen aus dem Emulator und gibt sie an den `EventBatcher`.
- **Pins, die das Board nicht hat,** und Analogwerte für Pins ohne ADC-Kanal werden wie ungültige Befehle verworfen.


## 3a. Browser-Backend und Überwachung (Hauptthread)

`BrowserRuntime` (`client/src/lib/runtime/browser-runtime.ts`) setzt `SimulationRuntime` auf den Worker um. Der Worker entsteht beim ersten Start und bleibt zwischen Läufen; nach einem Abbruch (Fehler, Frist, Stille) wird er beendet und beim nächsten Start neu erzeugt.

- **Ablauf:** `start` sendet `load` (Flash übertragen, nicht kopiert), wartet auf `ready` und sendet erst dann `start` (der zweite Befehl beginnt eine neue `runId`; `ready` des Ladelaufs würde sonst verworfen). Der Zustand `running` gilt mit der Bestätigung. `pause`/`resume` wirken nur im Zustand `running`/`paused`; `reset` (neue `runId`) nur in einem der beiden. `stop` beendet den Lauf in der UI sofort (`RunGate.end`), die Antwort des Workers fällt weg.
- **Ereignisse:** `serial` → `serial_output`; `pins` → `pin_state_batch` (je Pin `mode` 0/1/2, `value`, bei PWM `pwm`; unveränderte Zustände entfallen); `status` → `simulation_status`; `fault` → `operation_error` (`RUNTIME_FAILED`). Zusätzlich nur im Browser: `runtime_usage`, `runtime_diagnostic`, `runtime_telemetry` (der bestehende Handler ignoriert sie).
- **Systemzeilen** wie beim Server: `--- Simulation paused ---`, `--- Simulation resumed ---`, `--- Simulation stopped ---`, `--- Simulation timeout (Ns) ---`, jeweils mit Zeilenende, als `serial_output`.
- **Fristen** (`SupervisionLimits`): `ready` 15 s nach `load`; Bestätigung von `start`/`pause`/`resume`/`reset` 5 s; `stop` 2 s (danach `terminate()`); Heartbeat höchstens 3 s Stille, sobald die Maschine geladen ist (der Worker sendet etwa alle 500 ms, auch in der Pause). Wer eine Frist reißt, wird beendet; die UI bekommt `operation_error`, eine Fehlerzeile und `stopped`.
- `error` und `messageerror` des Workers enden den Lauf auf dieselbe Weise.
- Serielle Eingabe geht in Stücken zu höchstens 1024 Zeichen an Port 0, nur im Zustand `running`.

## 4. Headless-Lauf

`runHeadless(image, { simMs, events, expectState, eeprom? })` (`packages/avr-emulator/src/headless/`) führt ein Abbild so schnell wie möglich ohne Wanduhr, Pacing und Timeout aus; das Ergebnis ist deterministisch. Das Werkzeug `npm run emulate -- <sketch.hex> [--elf …] [--ms …] [--events …] [--case …] [--repeat n] [--json]` ruft ihn auf.

Reize `events` (Zeit in simulierten ms, aufsteigend nicht erforderlich):

| Eintrag | Wirkung |
|---|---|
| `[ms, "serial", text, port?]` | Text an Serial-Port (Standard 0) |
| `[ms, "pin", pin, level]` | Pin von außen auf 0 oder 1 treiben |
| `[ms, "adcVolts", channel, volts]` (auch `"adc"`) | Spannung am ADC-Kanal (0 = A0 am Uno) |

Zustandsprüfungen `expectState`, ausgewertet zur angegebenen Zeit nach den Reizen derselben Zeit; ein Eintrag zur Endzeit des Laufs zählt mit:

| Eintrag | Prüfung |
|---|---|
| `[ms, "pin", pin, mode, level]` | Modus (`INPUT`, `OUTPUT`, `INPUT_PULLUP`) und Pegel |
| `[ms, "pwm", pin, duty]` | Tastverhältnis 0–255 |
| `[ms, "adcRaw", channel, value]` | Ergebnis der letzten Wandlung in ADCL/ADCH, nur gültig, solange ADMUX diesen Kanal wählt |

Unbekannte Arten, falsche Argumente und ein ADC-Kanal, den das Board nicht hat, sind ein Fehler vor dem Lauf. Das Ergebnis enthält Serial-Text je Port (unverändert, `println` endet mit CRLF), Pins, I/O-Funde, Diagnosen, die Prüfergebnisse und die Geschwindigkeit (simulierte je Wanduhrzeit). Das Werkzeug endet mit Code 1, wenn eine Prüfung fehlschlägt, und mit 2 bei Bedienfehlern.

## 5. Artefakt und Build-Identität

Der Compile (`ArduinoCompiler`, direkt und im Compile-Worker) baut nach einem erfolgreichen Build für jedes Katalogboard ein Artefakt (`artifact` im Compile-Ergebnis; Schema `shared/simulation-artifact.ts`): das Flash-Abbild des Pakets (benutzter Bereich ab Adresse 0 als Base64, Board, `flashBytes`, SHA-256, Symbole aus dem ELF) plus `buildId`. Ein Build für eine FQBN außerhalb des Katalogs oder mit nicht baubarem Abbild liefert kein Artefakt, der Compile gilt trotzdem als erfolgreich.

**Build-Identität (E15).** Sie umfasst das Format des Artefakts, den Sketch-Hash (Code, Header, Entry-File, FQBN), die FQBN mit Optionen, die `arduino-cli`-Version, ID und Version aller installierten Cores, einen Fingerabdruck der installierten Bibliotheken, die angeforderten Bibliotheken und die festen Build-Flags. `buildId` ist das SHA-256 ihrer kanonischen Form.

**Cache.** Der HEX-Cache und der Sofort-Cache behalten ihren Schlüssel (Sketch-Hash). Neben jedem Eintrag liegt `<schlüssel>.artifact.json` mit der Identität und – falls gebaut – dem Artefakt. Ein Treffer gilt nur, wenn der Sidecar existiert, lesbar ist und seine Identität der aktuellen gleicht (und ein enthaltenes Artefakt zur `buildId` passt). Fehlt der Sidecar oder weicht etwas ab (andere `arduino-cli`-, Core- oder Bibliotheksversion, andere angeforderte Bibliotheken oder Build-Flags), wird neu gebaut und der Eintrag überschrieben. Die Eviction entfernt den Sidecar mit dem HEX.

**Auslieferung.** `POST /api/compile` nimmt `artifact` nur in eine erfolgreiche Antwort auf und nur, wenn der Betrieb es ausliefern darf: im lokalen Profil ja, im Docker-Profil nein, bis es die Compile-Sandbox gibt (Plan P2.4, `docs/SECURITY.md`). Das Feld `binary` gibt es nie. Der In-Memory-Ergebniscache der Route hält das Ergebnis ohne `binary` und mit höchstens einem `artifact`; wo die Auslieferung verboten ist, steht es auch nicht im Cache. Die REST-Version ist `1.1.0` (Entscheidung E14; `1.0.0` bleibt akzeptiert), das Feld ist additiv.

