# Funktionsbeschreibung: Simulations-Laufzeit (Emulationskern)

Status: current  
Zielrolle: feature-contract  
Ziel-SSOT für die Laufzeit des Emulationskerns `@unosim/avr-emulator`: Diagnosen und ihre Grenzen sowie Befehle und Ereignisse zwischen UI und Worker. Zeitmodell, Speichermodell, Überwachung des Workers und Modellannahmen kommen mit den Paketen P1.12 und P3.1 des [Umsetzungsplans](../docs/proposals/browser-emulation-plan.md) hinzu. Der Plan ist nicht normativ; dieses Dokument gilt für das, was der Code umsetzt.

## Governance-Grenzen

- Das Dokument beschreibt Verhalten des Pakets `packages/avr-emulator/`. Das Paket importiert nichts aus UnoSim.
- Die Anzeige der Diagnosen (Systemzeile, Debug-Konsole) und ihre Texte gehören zur UI und zu `docs/USER_GUIDE.md`; das Paket liefert strukturierte Ereignisse.
- Tests ergänzen `docs/TESTING_STANDARDS.md`.

## 1. Diagnosen

Der Emulator meldet genau vier Fälle. Abruf: `emulator.takeDiagnostics()` liefert die Ereignisse seit dem letzten Aufruf, jedes mit `kind`, den Angaben des Falls und `simTimeMs`.

| `kind` | Bedingung | Angaben |
|---|---|---|
| `stack-overflow` | SP liegt unter `__bss_end` (`region: "bss"`) oder, falls `malloc` gelinkt ist und `__brkval` ungleich 0 ist, unter `__brkval` (`region: "heap"`) | `sp`, `limit` (Datenraumadressen) |
| `pc-out-of-program` | PC liegt hinter dem letzten programmierten Wort des Abbilds (gelöschter Flash) | `pc`, `programBytes` (Byteadressen) |
| `watchdog-reset` | Der Watchdog löst einen Reset aus (WDE gesetzt, WDIE nicht) | – |
| `sleep-interrupts-disabled` | `SLEEP` wird bei gesetztem SE-Bit und gelöschtem globalem Interrupt-Flag ausgeführt | `pc` (Byteadresse) |

### 1.1 Zeitpunkt der Prüfung

- Stack und PC werden am Ende jedes Rechenabschnitts (4000 Takte) geprüft; der Stack zusätzlich bei jedem Schreibzugriff auf SPL.
- `PUSH`, `CALL` und Interrupts ändern SP in avr8js ohne Hook. **Ein Überlauf, der vor der nächsten Prüfung zurückgeht, bleibt unerkannt.**
- `SLEEP` wird nur geprüft, solange das SE-Bit gesetzt ist (davor ist `SLEEP` wirkungslos).
- Ohne das Symbol `__bss_end` im ELF des Abbilds entfällt die Stack-Prüfung. `__brkval` fehlt, solange `malloc` nicht gelinkt ist; dann gilt nur `.bss`.

### 1.2 Wiederholung

Eine Bedingung wird einmal gemeldet und erst wieder, nachdem sie geendet hat (Stack über der Grenze, PC im Programm, SE gelöscht). Ein Watchdog-Reset wird bei jedem Reset erkannt. Gleiche Diagnosen desselben Laufs erscheinen höchstens einmal je simulierter Sekunde.

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
| `load` | `board`, `buildId`, `sha256`, `flash` (`ArrayBuffer`), `symbols` | bekanntes Board, `buildId` 1–256 Zeichen, `sha256` 64 Hexziffern, Flash 1 Byte bis 256 KiB |
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

