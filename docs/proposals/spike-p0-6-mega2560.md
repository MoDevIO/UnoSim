# Spike P0.6: Mega 2560

> **Nicht normativ.** Spike-Bericht zu Arbeitspaket P0.6 aus
> [browser-emulation-plan.md](browser-emulation-plan.md). Die Ergebnisse gehen
> in ADR 0009 (Entscheidung E3, Mega-Umfang) ein; der Bericht wird danach mit
> dem Plan gelöscht. Prototypcode: [spikes/p0-6/](../../spikes/p0-6/).

## Ziel

Prüfen, ob avr8js 0.21.1 ein ATmega2560-Abbild aus `arduino:avr@1.8.8` korrekt
ausführt: HEX über 64 KB (Datensätze Typ 02/04), 22-Bit-PC, Datenraum bis
`0x21FF` (avr8js-Parameter 8448), Timer 3–5 und USART1–3 als eigene
Konfigurationen; Probe mit `Serial1` und PWM an 44–46.

## Aufbau

- Drei Sketches ([spikes/p0-6/sketches/](../../spikes/p0-6/sketches/)), FQBN
  `arduino:avr:mega:cpu=atmega2560`, `arduino-cli` 1.5.1:
  - `mega_probe` (5006 Byte): `int`-Überlauf, `sizeof`, `Serial` bis
    `Serial3` mit verschiedenen Baudraten, `analogWrite` an 44, 45, 46
    (Timer 5), 2 (Timer 3), 9 (Timer 2), 13 (Timer 0), `delay(587)`,
    `analogRead(A0)` und `analogRead(A15)` (MUX5), `digitalPinToTimer(44)`,
    RAMEND und SP.
  - `mega_far` (152 774 Byte): 5 × 30 000 Byte PROGMEM aus
    [gen-bigdata.mjs](../../spikes/p0-6/gen-bigdata.mjs), Summe über
    `pgm_read_byte_far`, ein indirekter Aufruf in Code oberhalb 128 KB.
  - `mega_combined` (155 330 Byte): `mega_probe` plus die Far-Daten.
- Mega-Profil im Spike ([mega-run.mjs](../../spikes/p0-6/mega-run.mjs)):
  Vektoren und Registeradressen aus `avr/iomxx0_1.h` der gepinnten Toolchain.
  Timer 0–2 mit Mega-Vektoren (13–23) und Mega-Vergleichspins, Timer 3–5 als
  16-Bit-Timer mit Kanal C (Vektoren 31–50), USART0 mit Vektoren 25–27,
  USART1–3 (36–38, 51–53, 54–56), ADC mit Vektor 29, 16 Kanälen und MUX5
  (`muxInputMask` 0x3F, Kanäle 0x20–0x27 = ADC8–15), Ports A–L ohne die
  Interrupt-Verdrahtung des 328P. Datenraum mit Parameter `RAMEND + 1 − 0x100`
  = 8448.
- Erwartungen unabhängig vom Emulator: Ausgaben und Werte aus Core-Quelltext
  und Datenblatt (`derived`), Far-Summe in JavaScript berechnet.
- Messgerät: Apple M2 Pro, Node 24, ein Kern.

## Ergebnisse

| Prüfung | Erwartung (Herkunft) | avr8js mit Mega-Profil |
|---|---|---|
| HEX-Datensätze | 00, 01, über 64 KB 02 (`avr-objcopy`) | `mega_far`: 00, 01, 02; 152 774 Byte geladen |
| 22-Bit-PC | aktiv bei 256 KB Flash | `pc22Bits = true`; Code bis 0x2546C ausgeführt |
| indirekter Aufruf oberhalb 128 KB (EIND-Trampolin) | `indirect call ok` | ✔ |
| Far-PROGMEM-Summe | 19 124 632 (berechnet) | 19 124 632 |
| SP nach Reset, Datenraum | 0x21FF, 0x2200 Byte | 0x21FF, 0x2200 Byte |
| `RAMEND`, SP in `setup()` | 0x21FF, 0x21FC | 0x21FF, 0x21FC |
| `int 32767 + 1`, `sizeof` int/long/double | −32768, 2/4/4 | ✔ |
| `delay(587)` mit `millis()` | 586–587 ms | 586 ms |
| `analogRead(A0)` bei 2,5 V, `analogRead(A15)` bei 3,42 V | 512, 700 | 512, 700 |
| `Serial`–`Serial3` | Texte vollständig | ✔ alle vier |
| Baudraten (U2X, UBRR des Cores) | 117 647, 9 615, 19 230, 58 823 | ✔ |
| `digitalPinToTimer(44)` | 18 (`TIMER5C`) | 18 |
| PWM-Register | OCR5C/B/A = 25/128/200, OCR3B = 77, OCR2B = 99, OCR0A = 10 | ✔; TCCR5A = `10101001` (COM5A1, COM5B1, COM5C1, WGM50) |

Echtzeitfaktor: 3,9 (`mega_probe`) und 4,1 (`mega_far`) gegenüber 5,2 beim
Uno (Spike P0.4, gleiche Maschine). Sechs Timer und vier USARTs kosten Zeit je
Takt; der Faktor bleibt deutlich über 1.

## Gegenproben

- **328P-Konfigurationen von avr8js** (`--no-mega-config`): Der Sketch gibt
  nur `iiii…` aus; Timer- und USART-Interrupts springen auf falsche Vektoren.
  Eigene Mega-Profile sind also Pflicht, auch für Timer 0–2 und USART0.
- **Standardparameter 8192** (`--default-sram`): avr8js legt nur 0x2100 Byte
  Datenraum an, der Stack bei RAMEND 0x21FF liegt außerhalb, der Sketch gibt
  nichts aus. Das bestätigt Plan 4.3: Das Profil muss 8448 übergeben.
- **Pin-Tabellen oberhalb 64 KB** (`mega_combined`): Mit 150 KB PROGMEM legt
  der Linker die Pin-Tabellen des Cores nach 0x24B7C. Der Core liest sie mit
  `lpm`, das nur die unteren 64 KB adressiert. `digitalPinToTimer(44)` liefert
  dadurch 128 (Byte `big4[18972]` an 0x4BA8, unabhängig berechnet), und
  `analogWrite` setzt keinen Timer. Das ist Verhalten des Codes, nicht des
  Emulators: Am Board führen dieselben Befehle zum selben Ergebnis (abgeleitet
  aus Linker-Belegung und `lpm`, nicht am Board gemessen). In `mega_far`
  bleibt die eine verwendete Tabelle unter 64 KB; die Lage hängt davon ab,
  welche Tabellen gelinkt werden.

## Kriterium

Der Plan nennt für P0.6 kein Zahlenkriterium. Alle geprüften Merkmale
verhalten sich wie erwartet: HEX über 64 KB, 22-Bit-PC, Datenraum bis 0x21FF,
Timer 3–5, USART1–3, PWM an 44–46, `Serial1`, MUX5. **Erfüllt.**

## Folgen für die Entscheidungen

- **E3 (Boards, Mega-Umfang):** Der Mega 2560 bleibt im Umfang wie geplant.
- **P5.1 kleiner als geschätzt:** Timer 3–5 und USART1–3 brauchen keine neuen
  Peripherieklassen, nur Konfigurationen der vorhandenen `AVRTimer`
  (16 Bit mit Kanal C) und `AVRUSART`. Zusätzlich nötig und im Plan bisher
  nicht genannt:
  - Mega-Vektoren auch für Timer 0–2, USART0 und ADC;
  - Port-Konfigurationen mit der Interrupt-Verdrahtung des ATmega2560
    (INT0–3 an PD0–3, INT4–7 an PE4–7, PCINT0 an Port B, PCINT1 an PE0/PJ0–6,
    PCINT2 an Port K); im Spike sind sie ausgelassen;
  - die MUX5-Kanalbelegung des ADC.
- **Board-Hinweis für P5.4:** Sketches mit über 64 KB PROGMEM können die
  Pin-Tabellen des Cores aus dem `lpm`-Bereich schieben. Das ist Verhalten des
  echten Boards; das Benutzerhandbuch kann es bei der Freigabe des Mega
  nennen, ein Fall der Klasse `derived` hält es im Korpus fest.
- **E12 (Echtzeit):** Mega rund 25 % langsamer als Uno im Node-Lauf; P0.3
  misst die Referenzgeräte auch mit einem Mega-Sketch.
- **E6, E7, E11:** nicht berührt.
