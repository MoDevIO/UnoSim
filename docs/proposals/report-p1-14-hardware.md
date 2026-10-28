# P1.14 Hardwareaufnahmen am echten Uno

> **Nicht normativ.** Messbericht zu P1.14 aus [browser-emulation-plan.md](browser-emulation-plan.md).
> Der Bericht wird mit dem Plan gelöscht.

## Aufbau

| | |
|---|---|
| Board | Arduino Uno R3, Original (USB `2341:0043`, Seriennummer `7583331373335101E130`), ATmega328P mit ATmega16U2 als USB-Brücke |
| Host | macOS (Darwin 25.6), arduino-cli 1.5.1, Kern `arduino:avr` 1.8.8, Port `/dev/cu.usbmodem1101` |
| Werkzeug | `npm run record:hardware -- <Fall> --port <Port> --accept "<Board>"` (`scripts/record-hardware.ts`) |
| Ablauf je Fall | Sketch neu hochladen, 3 s warten, Port öffnen (der Reset kommt über DTR), seriellen Text einspielen, `3,3 s + simMs + 0,5 s` aufnehmen, mit der Erwartung vergleichen (Zeilen, Toleranzen des Falls) |
| Annahme | `--accept` übernimmt nur, wenn die Aufnahme der Erwartung entspricht (genau oder in den Toleranzen des Falls); dann Klasse `hardware` mit den gemessenen Werten |

## Ergebnis

Von 64 Fällen sind **44** Klasse `hardware` (vorher keiner).
Alle Fälle ohne Verdrahtung stimmen mit dem Board überein, **außer `it05-05`** (unten).
Die Aufnahme jedes Falls liegt als `recorded.uno.txt` neben dem Fall.

| Prüfung | Ergebnis |
|---|---|
| Datentypen, Überlauf, Fließkomma, Zufall (`random`), `parseInt`, Matrizen, Strukturen | gleich |
| Serielle Eingabe (5 Fälle, automatisch gesendet), `serial_read_while_printing` | gleich |
| Zeit (`millis_delay`, `it03-07`) | in den Toleranzen; Board misst `delay(100)` = 99, `delayMicroseconds(1000)` = 1008 (genau am Rand von ±8), `10 x delay(50)` = 501; die Erwartungen tragen jetzt diese Werte |
| Speicher: `memory_layout`, `memory_values` | gleich, auch die Compiler-abhängigen Werte (`SP in setup = 0x8FA`, `__bss_end = 0x1EC`, `free = 1807`) mit dem gepinnten Kern |
| SP nach Reset (`sp_at_reset`, neu) | `0x8FF` = RAMEND, gleich |

### Speicherprobe: feste und compilerabhängige Werte

| Wert | Art | Board | Emulator |
|---|---|---|---|
| RAMEND = 2303, E2END = 1023, FLASHEND = 32767 | fest (ATmega328P) | gleich | gleich |
| SP nach Reset (`.init3`) = 0x8FF | fest (MCU) | gleich | gleich |
| EEPROM-Löschwert 255, Schreiben/Lesen Zelle 17 und 1023 | fest | gleich | gleich |
| SP in `setup()` = 0x8FA, `__bss_end` = 0x1EC, frei = 1807 | **abhängig von Compiler und Kern** (Regressionsfall `memory_values`) | gleich für avr-gcc und Kern 1.8.8 | gleich |

## Abweichungen

### 1. `it05-05-intervall-ohne-delay`: Emulator, ca. 0,006 %

Das Board schafft pro Ausgabe 8 Schleifendurchläufe weniger als der Emulator (reproduzierbar in 3 von 3 Läufen):

| Ausgabe | Erwartung (Emulator) | Board |
|---|---|---|
| Zeit: 500 ms | 137324 | 137316 |
| Zeit: 1000 ms | 274126 | 274110 |

Die Differenz wächst um 8 je Ausgabe, nicht mit der Zeit: Eine Ausgabe kostet auf dem Board rund 460 Takte mehr als im Emulator. Das passt zu einem Unterschied im Takt der UART-Unterbrechung (UDRE) je gesendetem Byte (rund 13 Takte bei 35 Byte); nicht untersucht, nicht belegt.
Einordnung: **Emulatorabweichung im Zyklenmodell der UART**, klein. Der Fall bleibt Klasse `regression`, die Erwartung ist unverändert, es gibt keine Toleranz (der Plan erlaubt Toleranzen nur für Zeitwerte). Die Aufnahme liegt als Beleg bei.

### 2. Bytes vor `Serial.begin()`: Emulator hält zurück, das Board verliert

Sketch und Aufnahmen: [results/p1-14/serial_before_begin/](results/p1-14/serial_before_begin/). Der Rechner sendet „ABC“, während der Sketch noch 5 s in `delay()` steht; danach `Serial.begin(115200)` und Ausgabe von `Serial.available()`.

| | `Serial.available()` nach `begin()` |
|---|---|
| Echter Uno (3 von 3 Läufen) | **0**, die Bytes sind verloren (Empfänger war aus, RXEN0 = 0) |
| Emulator | **3**, `SerialPorts` hält die Bytes bis zur Freigabe des Empfängers zurück (P1.7) |

Einordnung: **Emulatorabweichung** (kein Werkzeugfehler: das Senden nach `begin()` funktioniert in den fünf Eingabefällen). Der Plan enthält keine Entscheidung dazu.
**Entschieden und behoben** (Option B, boardgetreu): der Emulator verwirft die Bytes und meldet die Diagnose `serial-input-discarded`; der Fall `probes/serial_before_begin` ist am Board aufgenommen (Klasse `hardware`, vor `begin` 0, danach geliefert).

Vorschlag (zur Entscheidung):

- **A (empfohlen): Verhalten beibehalten**, als bekannten Unterschied dokumentieren. Begründung: Der Browser kann Eingaben senden, bevor der Sketch gestartet ist (Übersetzung, Start); Verlust wäre für Lernende schwer zu verstehen und hat auf dem Board nur selten Folgen, weil `Serial.begin()` in `setup()` direkt am Anfang steht.
- **B: boardgetreu verwerfen.** In `SerialPorts.pump` Bytes verwerfen, solange `rxEnable` aus ist, mit einem Hinweis in der Diagnose („n Bytes verworfen, Empfänger aus“). Rund 10 Zeilen; die Probe als Fall der Klasse `hardware` aufnehmen. Preis: Eingaben, die der Nutzer beim Start tippt, gehen verloren.

## Nicht erledigt (braucht Messaufbau)

19 Fälle brauchen Pins, Spannungen oder die Beobachtung von Pins; ein Mensch kann sie nicht auf 10–100 ms genau von Hand auslösen:

| Gruppe | Fälle | Was fehlt |
|---|---|---|
| Spannung an A0–A4 (statisch) | `adc_read`, `it08-01`, `it08-03`, `it08-05` | feste Spannungen 2,51 / 0 / 5 / 1,1 / 0,6 V (Spannungsteiler oder Poti mit Multimeter) |
| Spannung zeitlich | `it04-01`, `it04-02`, `it04-05`, `it05-01`, `it05-02`, `it05-03`, `it07-07` | Spannungsverlauf nach Zeitplan (zweiter Mikrocontroller mit DAC/RC-Glied) |
| Pins zeitlich | `it03-06`, `it04-04`, `pullup_input` | Pegelwechsel an Pin 2/3/4/6 im Takt von 20–200 ms (zweiter Mikrocontroller) |
| Nur Pinzustand | `it03-04`, `it03-05`, `it04-03`, `it07-01`, `pwm_duty` | Beobachtung der Ausgänge (Logikanalysator oder Oszilloskop); die serielle Aufnahme deckt `expectState` nicht ab |

## Werkzeugfehler, die beim ersten Lauf auf echter Hardware auftraten

Alle sind mit dem Lauf am Board belegt und behoben (Tests in `tests/server/record-hardware-lib.test.ts`):

1. `arduino-cli monitor` ohne `dtr=on,rts=on` löste keinen Reset aus.
2. Die Wartezeit bis zur ersten Ausgabe beträgt 3,2 s (Start von `arduino-cli monitor` plus Bootloader), nicht 2,5 s; Standard jetzt 3,3 s.
3. Die Toleranzen des Falls wurden nicht angewendet (`millis_delay` wäre abgelehnt worden).
4. Der USB-Baustein liefert beim Öffnen 1–6 Fremdbytes vor der ersten Zeile. Sie werden nur entfernt, wenn höchstens 8 Bytes davor liegen, mindestens eines kein Text ist, und die Zeile danach passt; jedes Entfernen wird mit den Bytes in Hex gemeldet.
5. Schließen des Ports setzt das Board nicht zurück; ein frei laufender Sketch liefert dann beim nächsten Öffnen die Mitte seines vorigen Laufs. Jeder Versuch lädt deshalb neu hoch.
6. Das Aufnahmefenster ist länger als das simulierte; Zeilen danach werden gemeldet und nicht verglichen.
7. Zu Anfang wurde ein Lauf mit Fremdbytes vor der ersten Zeile irrtümlich übernommen; zurückgenommen, `--accept` verlangt jetzt Übereinstimmung.

## Sind P1.14 und P0.3 ausreichend abgeschlossen?

P1.14 ist **für den Teil ohne Messaufbau abgeschlossen** (44 von 64 Fällen am Board bestätigt, alle Abweichungen eingeordnet), für Pins und Spannungen **nicht**: dafür fehlt ein Messaufbau, keine weitere Programmierung. P0.3 siehe [report-p0-3-vm-matrix.md](report-p0-3-vm-matrix.md).
