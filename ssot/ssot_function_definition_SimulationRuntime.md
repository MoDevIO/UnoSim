# Funktionsbeschreibung: Simulations-Laufzeit (Emulationskern)

Status: current  
Zielrolle: feature-contract  
Ziel-SSOT für die Laufzeit des Emulationskerns `@unosim/avr-emulator`: Diagnosen und ihre Grenzen. Zeitmodell, Speichermodell, Worker-Protokoll und Modellannahmen kommen mit den Paketen P1.11 und P3.1 des [Umsetzungsplans](../docs/proposals/browser-emulation-plan.md) hinzu. Der Plan ist nicht normativ; dieses Dokument gilt für das, was der Code umsetzt.

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
