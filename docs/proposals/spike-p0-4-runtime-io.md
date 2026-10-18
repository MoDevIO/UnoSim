# Spike P0.4: Laufzeit-IO-Erkennung

> **Nicht normativ.** Spike-Bericht zu Arbeitspaket P0.4 aus
> [browser-emulation-plan.md](browser-emulation-plan.md). Die Ergebnisse gehen
> in ADR 0009 (Entscheidung E7) ein; der Bericht wird danach mit dem Plan
> gelöscht. Prototypcode: [spikes/p0-4/](../../spikes/p0-4/).

## Ziel

Messen, wie genau avr8js die Paare aus Pin und Funktion (`pinMode`,
`digitalWrite`, `digitalRead`, `analogRead`, `analogWrite`) zur Laufzeit
erkennt: zuerst über Registerzugriffe (`readHooks`, `writeHooks`), danach mit
ELF-Symbolen als Ergänzung. Ergebnis laut Plan: Tabelle der
Zuordnungsgenauigkeit je Funktion mit und ohne Symbole und eine Entscheidung,
welche Laufzeitfunde die Registry zeigt.

## Aufbau

- **Sketches:** die 51 Beispiele aus UnoSim-Examples `v3.0.0` und die
  IoRegistry-SSOT-Testfälle 1–11 als eigene Sketches
  ([spikes/p0-4/sketches/](../../spikes/p0-4/sketches/)).
- **Builds** ([build-sketches.sh](../../spikes/p0-4/build-sketches.sh)),
  `arduino-cli` 1.5.1, `arduino:avr@1.8.8`, `arduino:avr:uno`:
  - wie UnoSim baut (mit LTO); das ist das Abbild, das die Emulation ausführt;
  - als **Referenz** ohne LTO. Dort sind die fünf Funktionen echte Aufrufe mit
    Symbol; ein Einsprung-Haken liest Pin (`r24`) und Wert bzw. Modus (`r22`).
    Aufrufe innerhalb einer anderen I/O-Funktion (`analogWrite` ruft
    `pinMode`) zählen nicht. Die Referenz ist die Grundwahrheit „was wurde
    ausgeführt“.
- **Statisch:** `analyzeStaticIO` aus `shared/io-registry-parser.ts`
  ([static-pairs.mjs](../../spikes/p0-4/static-pairs.mjs)).
- **Laufzeit** ([runtime-io.mjs](../../spikes/p0-4/runtime-io.mjs)), avr8js
  0.21.1, Uno-Peripherie wie im Prototyp des Vorschlags, je Lauf 3000 ms
  simulierte Zeit mit festen Reizen (serielle Eingaben, alle Eingänge
  abwechselnd LOW/HIGH, ADC-Spannung 2,5 V und ab 800 ms 4,0 V). Eigene Hooks
  rufen die Hooks der Peripherie weiter auf und ändern keine Werte. Drei
  Stufen:
  - **R0 (nur Bitänderungen):** DDR-Bit gesetzt → `pinMode(OUTPUT)`, gelöscht
    → `pinMode(INPUT)`; PORT-Bit geändert → `digitalWrite`; `ADSC` gesetzt →
    `analogRead` über den ADMUX-Kanal; COM-Bit gesetzt oder OCR geschrieben
    bei gesetztem COM-Bit → `analogWrite` über den Timer-Kanal; Lesen des
    PIN-Registers → nur der Port.
  - **R1 (plus Befehlsdekodierung):** Im Hook zeigt `cpu.pc` auf den
    zugreifenden Befehl. `SBI`, `CBI`, `SBIS` und `SBIC` tragen das Bit im
    Opcode. Bei `ST`/`STS`/`OUT` ohne Bitänderung liefert der vorangehende
    `ORI`/`OR`/`ANDI`/`AND` die Maske; bei `IN`/`LD`/`LDS` auf ein
    PIN-Register liefert einer der nächsten Befehle auf dem Zielregister
    (`ANDI`, `AND`, `SBRS`, `SBRC`) das Bit. Gewertet werden nur
    Einbit-Masken, denn jede der fünf Funktionen berührt genau ein Bit. Ein
    PORT-Schreibzugriff höchstens 24 Takte nach einem DDR-Schreibzugriff ohne
    gesetztes Bit gehört zu `pinMode(INPUT|INPUT_PULLUP)`: Das geänderte
    PORT-Bit nennt den Pin, sein Wert den Modus.
  - **R2 (plus Unterdrückung):** wie R1; ein `pinMode(OUTPUT)` auf einem
    PWM-Pin, auf das binnen 200 Takten das COM-Bit dieses Pins folgt, ist Teil
    von `analogWrite` und zählt nicht.
- **Auswertung** [evaluate.mjs](../../spikes/p0-4/evaluate.mjs), Rohdaten
  unter [spikes/p0-4/results/](../../spikes/p0-4/results/).

## Symbole nach LTO

In **1 von 62** Builds steht nach LTO überhaupt eine der fünf Funktionen als
Symbol im ELF (`digitalWrite` in IT03.5). Alle übrigen Aufrufe sind
eingebettet. Die Symbolverfeinerung des Plans (Einsprung-Haken auf `r24`/`r22`)
fällt damit für das ausgeführte Abbild praktisch aus. Nebenbefund für P1.10:
`__bss_end` und `_end` stehen in jedem ELF, `__heap_start` nicht, `__brkval`
nur mit gelinktem `malloc`.

## Zuordnungsgenauigkeit

Gegen die Referenz, alle 62 Sketches, Paare aus Funktion und Pin (TP
gefunden, FN übersehen, FP fälschlich gemeldet):

| Funktion | Referenz | R0 TP / FN / FP | R1 TP / FN / FP | R2 TP / FN / FP | Modus richtig (R1/R2) |
|---|---|---|---|---|---|
| `pinMode` | 15 | 11 / 4 / 0 | 15 / 0 / 0 | 15 / 0 / 0 | 15 von 15 |
| `digitalWrite` | 12 | 11 / 1 / 3 | 11 / 1 / 1 | 11 / 1 / 1 | – |
| `digitalRead` | 7 | 0 / 7 / 0 (7 × nur Port) | 7 / 0 / 0 | 7 / 0 / 0 | – |
| `analogRead` | 14 | 14 / 0 / 0 | 14 / 0 / 0 | 14 / 0 / 0 | – |
| `analogWrite` | 2 | 2 / 0 / 0 | 2 / 0 / 0 | 2 / 0 / 0 | – |

„Mit Symbolen“ wäre die Referenzspalte; im LTO-Build gibt es sie nicht (siehe
oben). Die Befehlsdekodierung ersetzt sie.

Die verbleibenden Abweichungen:

- **FN `digitalWrite`, SSOT-Fall 7:** `digitalWrite(5, LOW)` auf einen schon
  niedrigen Pin. Der Core rechnet über die Pin-Tabelle (`lpm`) und
  `com r16; and r16, r25; st X, r16`; danach steht die Maske in keinem
  Register mehr, und das Bit ändert sich nicht. Der Fund bleibt portgenau
  (Port D).
- **FP `digitalWrite`, IT04.3:** `analogWrite(11, 0)` bzw. `255` schaltet im
  Core digital; das erscheint als `digitalWrite(11)`. So steht es bereits im
  Plan (4.9).
- **R0:** Ohne Dekodierung ist `digitalRead` nie pin-genau, `pinMode(INPUT)`
  auf einem Pin im Grundzustand und `INPUT_PULLUP` werden übersehen oder als
  `digitalWrite` gemeldet.

## Abgleich mit der statischen Analyse

| Funktion | statische Paare | davon ausgeführt (Referenz) | davon zur Laufzeit bestätigt (R2) | R0 |
|---|---|---|---|---|
| `pinMode` | 15 | 15 | 15 | 11 |
| `digitalWrite` | 13 | 12 | 11 | 11 |
| `digitalRead` | 6 | 6 | 6 | 0 |
| `analogRead` | 8 | 8 | 8 | 8 |
| `analogWrite` | 2 | 2 | 2 | 2 |

- 42 von 44 statischen Paaren (95 %) werden mit R2 bestätigt, 32 mit R0.
  Ein nicht bestätigtes Paar wurde gar nicht ausgeführt (IT05.4, Menüzweig
  ohne passende Eingabe), das andere ist Fall 7.
- 7 ausgeführte Paare hat die statische Analyse nicht: `digitalRead(p)` mit
  `p = random(0, 5)` (SSOT-Fall 8) und je drei `analogRead` über Pins in
  Struct-Arrays (IT08.3, IT08.5). Die Laufzeit erkennt alle 7 pin-genau.

## IoRegistry-SSOT-Testfälle 1–11

| Fall | statisch | Laufzeit R0 | Laufzeit R2 |
|---|---|---|---|
| 1 `pinMode(13, OUTPUT)` | ✔ | ✔ OUTPUT | ✔ OUTPUT |
| 2 `digitalRead(A0)` | ✔ | nur Port C | ✔ |
| 3 Array + Schleife, `digitalWrite` 2, 3 | ✔ | ✔ | ✔ |
| 4 `const int led = 12` | ✔ | ✔ | ✔ |
| 5 `#define BTN A3`, `pinMode(INPUT)` | ✔ | übersehen | ✔ INPUT |
| 6 `digitalWrite(9, HIGH)` in `loop()` | ✔ | ✔ einmal | ✔ einmal |
| 7 `digitalRead(5)`, `digitalWrite(5, LOW)` | ✔ | nur Port D | Read ✔, Write nur Port D |
| 8 `digitalRead(random(0, 5))` | – | nur Port D | ✔ Pin 4 |
| 9 `pinMode(A0, INPUT)`, `digitalWrite(A0, HIGH)` | ✔ | nur `digitalWrite` | ✔ beide, INPUT |
| 10 `digitalRead(pins[1])` | ✔ | nur Port B | ✔ Pin 8 |
| 11 `pinMode(13)` OUTPUT, dann INPUT | ✔ | ✔ beide Modi | ✔ beide Modi |

„Einmal“ heißt: Ein Fund entsteht nur beim ersten Auftreten je Pin und
Funktion bzw. bei einem neuen Modus (SSOT „Kein Spam“). Fall 11 liefert beide
Modi, damit die Konfliktlogik greifen kann.

## Kosten

Median-Echtzeitfaktor auf Apple M2 Pro (Node 24, ein Kern): 5,21 ohne und
5,20 mit Beobachtung. Ein Sketch, der in `loop()` nur `digitalWrite` aufruft
(Fall 6), läuft mit Beobachtung um den Faktor 1,6 langsamer, weil fast jeder
Schleifendurchlauf einen Hook auslöst. Die Dekodierung prüft nur im Hook und in einem
Fenster von höchstens 6 Befehlen nach einem PIN-Lesezugriff, nicht je Befehl.

## Ergebnis

- **Kriterium (Plan):** Tabelle der Zuordnungsgenauigkeit liegt vor; die
  Verfügbarkeit der Symbole ist keine Voraussetzung. **Erfüllt.**
- **Entscheidung, welche Laufzeitfunde die Registry zeigt:** alle
  pin-genauen Funde der Stufe R2 mit Herkunft `runtime`. Portgenaue Funde
  erscheinen nicht in der Tabelle und lösen keine Warnung aus; statische
  Einträge bleiben davon unberührt. Die Registry bleibt dadurch frei von
  erfundenen Zuordnungen.

## Folgen für die Entscheidungen

- **E7 (Laufzeit-Registry):** tragfähig wie geplant und genauer als
  angenommen. Grundlage bleibt die Registerbeobachtung; die Verfeinerung
  geschieht über die **Befehlsdekodierung am zugreifenden Befehl**, nicht über
  ELF-Symbole, die nach LTO fast nie vorhanden sind. `digitalRead` ist damit
  pin-genau, auch IoRegistry-SSOT-Fall 8. ELF-Symbole bleiben eine optionale
  Ergänzung für die seltenen nicht eingebetteten Funktionen.
- **Plan:** Abschnitt 4.9, P1.9, Risiko „LTO bettet I/O-Funktionen ein“ und
  der offene Punkt zu `digitalRead` in Abschnitt 11 sind im selben PR
  angepasst. Als offener Punkt bleibt `digitalWrite` ohne Pegeländerung über
  die Pin-Tabelle des Cores (Fall 7). Eine mögliche Verfeinerung ist,
  `lpm`-Zugriffe auf die Pin-Tabellen des Cores kurz vor einem PORT-Zugriff zu
  beobachten.
- **P1.9:** übernimmt die Regeln aus R2 (Einbit-Masken, Zuordnung des
  PORT-Zugriffs von `pinMode` über ein Fenster von 24 Takten, Unterdrückung des
  `pinMode` in `analogWrite`) und die Fälle dieses Spikes als Tests mit
  vorkompilierten HEX-Fixtures.
- **E3, E6, E11, E12:** nicht berührt.
