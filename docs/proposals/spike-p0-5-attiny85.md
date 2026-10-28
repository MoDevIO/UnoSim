# Spike P0.5: ATtiny85

> **Nicht normativ.** Spike-Bericht zu Arbeitspaket P0.5 aus
> [browser-emulation-plan.md](browser-emulation-plan.md). Die Ergebnisse gehen
> in ADR 0009 (Entscheidung E11) ein; der Bericht wird danach mit dem Plan
> gelöscht. Prototypcode: [spikes/p0-5/](../../spikes/p0-5/).

## Ziel

Laut Plan: ATTinyCore per Board-Manager-URL in `arduino-cli` installieren,
Version pinnen, FQBN und Menüoptionen festlegen; Lizenz und Pflegezustand
prüfen, die Alternative damellis/attiny bewerten. In avr8js Port B, Timer0,
ATtinyTimer1 und ADC mit eigenen Konfigurationen betreiben, `millis()` bei
8 MHz prüfen und `Serial.print` am TX-Pin dekodieren. Speichermodell: SRAM ab
0x60, avr8js-Parameter 352, keine Peripherie ab 0x60.
*Ergebnis:* Core-Entscheidung, Pinbelegung, Umfang der seriellen Eingabe.

## Core

| | ATTinyCore (SpenceKonde) | damellis/attiny |
|---|---|---|
| Version | 1.5.2 vom 2021-03-11, letzte veröffentlichte; Entwicklungszweig 2.0.0 nicht veröffentlicht, letzter Commit 2024-10-18 | keine Releases, letzte Änderung 2021-11-17 |
| Board-Manager | `https://drazzy.com/package_drazzy.com_index.json` (auch per HTTPS), Archiv mit SHA-256 im Index (`35bb47dc…8eb3`) | Index-URL auf GitHub |
| Lizenz | LGPL 2.1 (`LICENSE.md`), wie der Arduino-AVR-Core | keine Lizenzdatei erkannt (GitHub: keine Angabe) |
| `Serial` | `TinySoftwareSerial`: TX an PB0 (AIN0), RX an PB1 (AIN1) über den Analogkomparator | kein `Serial`; nur die Bibliothek `SoftwareSerial` an frei gewählten Pins |
| Compiler | `arduino:avr-gcc@7.3.0-atmel3.6.1-arduino7`, derselbe wie `arduino:avr@1.8.8` | Compiler des Arduino-AVR-Cores |
| offene Issues | 53 | 39 |

**Entscheidung:** ATTinyCore, gepinnt auf **1.5.2**. Nur dieser Core hat
`Serial` auf dem ATtiny85, die Lizenz ist geklärt und gleich der des
Arduino-AVR-Cores, der Compiler ist derselbe. Risiko: Es gibt seit 2021 kein
Release mehr. Für einen festen Unterrichtsumfang ist das tragbar; ein
Versionswechsel braucht einen eigenen Spike.

**FQBN:** `ATTinyCore:avr:attinyx5:chip=85,clock=8internal`. Die übrigen
Optionen bleiben auf ihren Standardwerten und gehören zur Build-Identität
(E15): `TimerClockSource=default`, `LTO=enable`, `millis=enabled`,
`eesave=aenable`, `bod=disable`.

Installation isoliert nach
[build-sketches.sh](../../spikes/p0-5/build-sketches.sh): eigenes
`arduino-cli`-Datenverzeichnis, Board-Manager-URL über
`ARDUINO_BOARD_MANAGER_ADDITIONAL_URLS`. Mitinstalliert werden avrdude und
micronucleus, die UnoSim nicht braucht.

## Pinbelegung (Core 1.5.2, `variants/tinyX5/pins_arduino.h`)

| Arduino-Pin | Port | Funktion |
|---|---|---|
| 0 | PB0 | PWM (OC0A), `Serial` TX (AIN0) |
| 1 | PB1 | PWM (OC1A, `TIMER1_PWM`), `Serial` RX (AIN1), `LED_BUILTIN` |
| 2 | PB2 | A1 |
| 3 | PB3 | A3 |
| 4 | PB4 | PWM (OC1B), A2 |
| 5 | PB5 | RESET, A0 |

Das entspricht Anhang A des Plans; `LED_BUILTIN` ist 1.

## Aufbau der Emulation

[tiny-run.mjs](../../spikes/p0-5/tiny-run.mjs), avr8js 0.21.1, Adressen aus
`avr/iotnx5.h` der gepinnten Toolchain:

- CPU mit 8 KB Flash und Parameter 352: Datenraum 0x260 Byte, SP nach Reset
  0x25F. Alle verwendeten Peripherieregister liegen unter 0x60.
- Port B ohne die Interrupt-Verdrahtung des 328P.
- Timer0 als `AVRTimer` mit eigener Konfiguration (Register 0x48–0x59,
  TIMSK/TIFR-Bits des ATtiny85, Ein-Wort-Vektoren 5, 10, 11, Vergleichspins
  PB0/PB1).
- Timer1 als `ATtinyTimer1` mit der mitgelieferten `attinyTimer1Config`.
- ADC mit eigener Konfiguration (Kanäle ADC0–3, Bandlücke, Temperatur) und
  eigener Referenzauswahl, siehe Befund unten.
- **Software-UART-Dekoder:** Flanken an PB0 mit Taktzähler, solange PB0
  Ausgang ist und Timer0 den Pin nicht als PWM belegt. Bitbreite: die größte
  Standard-Bitzeit, von der fast alle Flankenabstände innerhalb eines Rahmens
  ganzzahlige Vielfache sind; Abtastung in Bitmitte; Text als UTF-8.
- **Analogkomparator (ACSR):** V+ ist die Bandlücke (ACBG) oder AIN0, V− ist
  AIN1 = PB1. ACO folgt dem Vergleich, ACIS0/1 wählen die Flanke, ACI und
  ACIE bilden den Interrupt (Vektor 7). Die serielle Eingabe treibt PB1 mit
  einer Wellenform in simulierter Zeit (Startbit, 8 Datenbits, Stoppbit).

## Ergebnisse

Sketches unter [spikes/p0-5/sketches/](../../spikes/p0-5/sketches/);
Erwartungen aus Core-Quelltext und Rechnung (`derived`):

| Prüfung | Erwartung | Ergebnis |
|---|---|---|
| Datenraum, SP nach Reset, RAMEND | 0x260 Byte, 0x25F, 0x25F | ✔ |
| `int 32767 + 1`, `print(2.5)` | −32768, 2.50 | ✔ |
| UTF-8-Umlaute über `Serial` | `äöü` | ✔ |
| Baudrate aus der Bitbreite | 9600 | 9600; gemessene Bitbreite 863 statt 833 Takte (+3,6 %), Timing der Warteschleife im Core |
| `delay(587)` mit `millis()` | 586–588 ms (Timer0, Teiler 64, Überlauf alle 2,048 ms) | 588 ms |
| `analogRead(A1)` bei 2,5 V, Referenz VCC | 512 | 512 |
| `analogRead(A3)` bei 0,5 V, Referenz 1,1 V | 465 | 465 |
| `analogRead(A3)` bei 0,5 V, Referenz 2,56 V | 200 | 200 |
| `analogWrite(4, 200)`, `analogWrite(0, 77)` | OCR1B = 200, OCR0A = 77 | ✔; TCCR0A = `10000011`, GTCCR = `01100000` |
| Eingabe `21⏎` an `parseInt()` | `got 21`, `twice 42`, danach `got 0` nach 1 s (das `\n` bleibt im Puffer, wie am Uno) | ✔ |

Echtzeitfaktor 9,1–10,1 (Apple M2 Pro, Node 24, ein Kern); der ATtiny85 hat
halb so viele Takte je Sekunde wie der Uno.

## Befunde zu avr8js

- **REFS2 an falscher Stelle.** avr8js wertet `REFS2` an Bit 3 von ADMUX aus
  (`0x08`); beim ATtiny85 ist Bit 3 `MUX3` und `REFS2` Bit 4. Mit der
  unveränderten Klasse liefert `analogRead` mit `INTERNAL2V56` **102** statt
  200 (`--avr8js-adc`). Das ATtiny-Profil braucht eine eigene
  Referenzauswahl (im Spike eine Unterklasse mit sieben Zeilen); ein Fehler
  upstream ist zu melden.
- **Kein Analogkomparator.** Ohne ihn empfängt `TinySoftwareSerial` nichts.
  Das Modell im Spike umfasst etwa 40 Zeilen.
- **Standard-Datenraum.** Ohne Parameter 352 läuft die Probe zwar (der
  Startcode setzt SP selbst auf RAMEND), aber 8 KB statt 512 Byte sind
  adressierbar (`--default-sram`); Speicherfehler blieben unbemerkt anders
  als am Board. Das Profil muss 352 übergeben (Plan 4.3).
- Timer0 und ADC des 328P sind mit eigenen Konfigurationen nutzbar; neue
  Peripherieklassen sind außer Komparator und ADC-Referenz nicht nötig.

## Umfang der seriellen Eingabe

**Machbar.** `TinySoftwareSerial` empfängt über den Komparator-Interrupt,
sobald der Emulator den Komparator nachbildet und PB1 im Bittakt treibt.
Grenzen, die genauso am Board gelten:

- Halbduplex: Während des Sendens sperrt der Core die Interrupts (`cli()`);
  Zeichen, die in dieser Zeit eintreffen, gehen verloren.
- Die Empfangsbaudrate muss der des Sketches entsprechen. Die Emulation
  kennt sie aus der Bitbreite der Ausgabe; sendet der Sketch nichts, gilt die
  im Serial Monitor eingestellte Baudrate (Standard 9600).
- Die Eingabe läuft über PB1; nutzt der Sketch PB1 anders (PWM,
  `LED_BUILTIN`), ist kein Empfang möglich.

## Kriterium

Der Plan nennt als Ergebnis Core-Entscheidung, Pinbelegung und Umfang der
seriellen Eingabe; alle drei liegen vor. Die Emulation stimmt in allen
geprüften Punkten mit den abgeleiteten Erwartungen überein. **Erfüllt.**

## Folgen für die Entscheidungen

- **E11 (ATtiny-Core):** bestätigt: ATTinyCore **1.5.2**, `chip=85`, 8 MHz
  intern, übrige Menüoptionen auf Standard. Serielle Eingabe wird
  unterstützt (nicht mehr „erst nach Spike“).
- **Plan:** P6.2 nennt die eigene ADC-Referenzauswahl, P6.3 die serielle
  Eingabe über das Komparatormodell; Anhang A trägt Version und
  `LED_BUILTIN`; der offene Punkt „Serielle Eingabe beim ATtiny85“ in
  Abschnitt 11 entfällt.
- **P2.3 (Toolchain):** Versionsdatei `1.5.2`, Prüfsumme aus dem Index
  prüfen, Board-Manager-URL per HTTPS; Lizenzhinweis LGPL 2.1 wie beim
  Arduino-AVR-Core.
- **E3, E6, E7, E12:** nicht berührt.
