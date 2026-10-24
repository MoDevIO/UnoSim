# Messungen und Aufnahmen durch Menschen

> **Nicht normativ.** Anleitung für alles, was im Rahmen von
> [browser-emulation-plan.md](browser-emulation-plan.md) nur eine Person
> erledigen kann: Messungen und Aufnahmen mit Geräten (Teile 1–4), Meldungen an
> avr8js (Teil 5), das README von UnoSim-Examples (Teil 6) und die
> Vorabversion (Teil 7). Wird mit dem Plan gelöscht. Ergebnisse gehen an den
> Agenten oder in die Statusdatei
> [browser-emulation-status.md](browser-emulation-status.md).

Alle Befehle laufen im Hauptverzeichnis des Repositorys auf dem Branch
`feature/browser-emulation` (nach dem Merge dieser Änderung), nach `npm ci`.

## Teil 1 – P0.3: Leistung im Browser (rund 1,5 Stunden)

> Ersatzmessung ohne Schulgeräte: [report-p0-3-vm-matrix.md](report-p0-3-vm-matrix.md) (Container mit 1 und 2 CPUs, `spikes/p0-3/run-vm-matrix.sh`). Eine reale Messung auf dem schwächsten Gerät bleibt sinnvoll, ist aber nicht mehr nötig, um Phase 3 zu beginnen.

**Ziel:** Herausfinden, ob schwache Unterrichtsgeräte die Emulation schnell
genug rechnen. *Kriterium:* Die **Spitzengeschwindigkeit** für IT05.5 ist auf dem
schwächsten Gerät mindestens **1,2**. Sonst legen wir vor Phase 3 die
Gegenmaßnahmen aus Abschnitt 10 des Plans fest.

**Was du brauchst:** drei Geräte aus dem Unterricht – ein schwaches Schulgerät,
ein Tablet, ein aktuelles Notebook – mit den Browsern, die dort verwendet
werden (Chrome, Firefox, Safari). Alle Geräte im selben WLAN wie der Rechner,
auf dem der Server läuft.

1. Auf dem Rechner mit dem Repository: `npm run spike:p03`. Die Ausgabe nennt
   `serving on http://0.0.0.0:8765/`. Das Terminal offen lassen.
2. Die Netzwerkadresse des Rechners feststellen (macOS: `ipconfig getifaddr en0`),
   zum Beispiel `192.168.1.20`.
3. Auf dem **Gerät unter Test**: alle anderen Tabs und Programme schließen,
   Netzteil anstecken, Energiesparmodus ausschalten.
4. Im Browser `http://192.168.1.20:8765/` öffnen. Die Seite zeigt zwei Knöpfe.
5. **Run** drücken und den Tab etwa 45 Sekunden im Vordergrund lassen (Tablet:
   Bildschirm nicht sperren). Die Seite misst nacheinander `int-probe`, IT05.5
   und IT11.5, je 2 s im Höchsttempo und 10 s in Echtzeit.
6. **Copy result** drücken und den Text in eine Datei einfügen, die nach Gerät
   und Browser benannt ist, zum Beispiel `schulgeraet-chrome.json`. Funktioniert
   das Kopieren nicht (manche Tablets), den Text auf der Seite markieren und
   kopieren.
7. Schritte 3 bis 6 für **jede** Kombination aus Gerät und Browser wiederholen
   (Zielwert: mindestens schwaches Gerät in allen Browsern, Tablet und Notebook
   in dem Browser, den die Schule nutzt).
8. Zusätzlich je Gerät **eine** Zeile notieren: Modell, Baujahr, RAM, Betriebssystem
   und, falls sichtbar, die CPU-Auslastung des Browsers während der Messung
   (Aktivitätsanzeige oder Task-Manager, nur ein Richtwert).

**So liest du das Ergebnis:**

| Wert | Bedeutung |
|---|---|
| `peakSpeed` | Wie viel schneller als ein echter Uno das Gerät maximal rechnet. 1,2 bedeutet: gerade genug. Ein Gerät mit 4 ist fast ohne Last. |
| `realTimeFactorMedian` | 1,00 heißt, das Gerät hält Echtzeit. Ist der Wert deutlich unter 1, läuft der Sketch langsamer als am Board. |
| `uiLagP95Ms`, `uiLagMaxMs` | Wie sehr die Seite hängt, während gerechnet wird. Bis etwa 50 ms ist das unauffällig, über 100 ms spürbar. |

Zum Vergleich: Ein Apple M2 Pro mit Chromium erreicht rund 4,6 bis 6,2.

**Danach:** Die JSON-Dateien und die Geräteangaben dem Agenten geben (oder
unter `docs/proposals/` als Messbericht ablegen). Er trägt das Ergebnis in
Statusdatei und ADR 0009 ein und markiert P0.3 als erledigt oder legt die
Gegenmaßnahmen fest.

## Teil 2 – P1.14: Aufnahmen am echten Uno (Klasse `hardware`)

**Ziel:** Die erwartete Ausgabe der Korpusfälle wird einmal am echten Board
aufgenommen. Erst dann belegt ein Fall die Übereinstimmung mit dem Board; bis
dahin gelten die Fälle als `derived` (unabhängig hergeleitet) oder
`regression`. Das Werkzeug lädt den Sketch hoch, setzt das Board zurück,
spielt die Eingaben ab und schreibt die Aufnahme neben den Fall.

**Was du brauchst**

- einen Arduino Uno R3 (Original, Revision notieren) und ein USB-Kabel,
- `arduino-cli` 1.5.1 mit `arduino:avr@1.8.8` (`arduino-cli core list` prüfen),
- für 14 Fälle mit Pins oder Spannungen: Steckbrücken, ein Potentiometer
  (10 kΩ) oder zwei Widerstände als Spannungsteiler, ein Multimeter,
- Geduld: 63 Fälle, die meisten brauchen unter 10 Sekunden.

**Einmalige Vorbereitung**

1. Board anschließen. `arduino-cli board list` zeigt den Port, zum Beispiel
   `/dev/cu.usbmodem1101` (Windows: `COM3`). Diesen Port in den Befehlen
   unten einsetzen. Wird das Board als „Unknown“ erkannt, ist das bei Klonen
   normal; die Revision trotzdem notieren.
2. Den Fall `data_types` zur Probe aufnehmen (Schritt „Ein Fall“ unten, ohne
   `--accept`). Stimmt die Ausgabe mit der Erwartung überein (`the recording
   equals the current expectation`), funktionieren Aufbau und Werkzeug.

**Ein Fall**

```sh
npm run record:hardware -- tests/fixtures/runtime-corpus/probes/data_types --port /dev/cu.usbmodem1101
```

Das Werkzeug lädt hoch, wartet 3 Sekunden, startet die Aufnahme und schreibt
`recorded.uno.txt` in den Ordner des Falls. Am Ende steht entweder
`the recording equals the current expectation` oder eine Liste der
abweichenden Zeilen.

- **Gleich:** Aufnahme übernehmen – derselbe Befehl mit
  `--accept "Arduino Uno R3, Rev. 3, USB-Kabel am Notebook"` (Angabe zum Board
  so genau wie möglich). Das Werkzeug ersetzt `expected.uno.txt`, stellt
  `case.json` auf die Klasse `hardware` und behält die frühere Herleitung als
  Hinweis. Dateien `recorded.uno.txt` danach löschen.
- **Abweichend:** **Nicht** übernehmen. Das ist ein Befund, genau dafür gibt es
  den Korpus: entweder war die Herleitung falsch oder die Emulation weicht ab.
  `recorded.uno.txt` und die Zeilen der Ausgabe dem Agenten geben; er klärt die
  Ursache und korrigiert die Emulation oder (begründet) die Erwartung.
- Zeitwerte (`millis`, `delay`) dürfen innerhalb der Toleranz im `case.json`
  abweichen; das Werkzeug zeigt trotzdem jede Abweichung, die Toleranz prüft
  erst der Korpus-Test.

**Reihenfolge**

1. **41 Fälle ohne Verdrahtung** – nur Board und Kabel. Beispiele: alle
   `it01-*`, `it02-*`, `it06-*`, `it07-01` bis `it07-06`, `it11-*`, die Proben
   `data_types`, `int_overflow`, `float_math`, `random_numbers`, `millis_delay`.
   Die vollständige Liste: Fälle in `tests/fixtures/runtime-corpus/*/*` mit
   leeren `events` und nichtleerer `expected.uno.txt`.
   Fälle mit `expectState` (zum Beispiel `pwm_duty`, `memory_layout`) werden
   zwar aufgenommen und verglichen, das Werkzeug **übernimmt sie nicht**:
   Zustände von Pins, PWM und ADC erfasst eine serielle Aufnahme nicht.
2. **5 Fälle mit serieller Eingabe** (`it03-02`, `it03-03`, `it05-04`, Proben
   `parse_int`, `serial_read_while_printing`): ebenfalls ohne Verdrahtung, das
   Werkzeug sendet den Text selbst.
3. **14 Fälle mit Pins oder Spannungen** (`it03-06`, `it04-01`, `it04-02`,
   `it04-04`, `it04-05`, `it05-01` bis `it05-03`, `it07-07`, `it08-01`,
   `it08-03`, `it08-05`, Proben `adc_read`, `pullup_input`): Das Werkzeug
   zeigt zu Beginn, was wann zu tun ist (`at +400 ms after the sketch starts:
   connect pin 2 to GND (LOW)`) und meldet sich im richtigen Moment mit einem
   Signalton und `NOW (+400 ms): …`. Vorher alles bereitlegen:
   - Pin auf LOW: Steckbrücke vom Pin nach GND halten oder stecken, auf HIGH:
     nach 5V; Eingang mit `INPUT_PULLUP` (Pins 2 und 3): LOW = Taster
     gedrückt, Brücke weg = losgelassen.
   - Spannung am Analogeingang: Potentiometer zwischen 5V und GND, Schleifer
     an den Pin, Spannung mit dem Multimeter **vorher** einstellen und die
     gemessene Spannung notieren. Die Fälle erwarten Werte wie 2,51 V; weicht
     die gemessene Spannung ab, den Fall mit dieser Spannung wiederholen
     (Wert in `events` des `case.json` eintragen) oder dem Agenten die
     gemessenen Werte geben.
   - Hinweis: Das Zeitfenster ist etwa ±100 ms. Wer das nicht trifft, wiederholt
     den Fall; die Aufnahme ist nur gültig, wenn die Reihenfolge der Eingaben
     stimmt.
4. **3 Fälle nur mit Zuständen** (`it03-04` Blinken, `it03-05` Lauflicht,
   `it04-03` PWM): haben keine serielle Ausgabe. Sie brauchen eine
   Beobachtung am Board (LED an Pin 13, 5 bis 7; bei PWM Multimeter oder
   Oszilloskop an Pin 11). Das ist ein eigener, späterer Schritt; bis dahin
   bleiben sie `derived`.

**Wenn etwas hakt**

| Symptom | Ursache und Abhilfe |
|---|---|
| Upload bricht ab | falscher Port; Board abziehen, anstecken, `arduino-cli board list` erneut |
| Ausgabe leer | zu kurze Bootzeit des Boards: `--boot-ms 4000` angeben |
| Ausgabe beginnt mit Müllzeichen | falsche Baudrate (steht im Sketch bei `Serial.begin`); der Sketch muss unverändert sein |
| Das Board startet während der Aufnahme neu | USB-Kabel oder Hub wackelt; direkt am Rechner anschließen |

**Danach:** Geänderte Dateien (`case.json`, `expected.uno.txt` der
übernommenen Fälle) per Pull Request gegen `feature/browser-emulation` geben
oder dem Agenten übergeben. Fälle mit Abweichung getrennt melden.

## Teil 3 – P7.1: Compile-Kapazität auf dem Referenz-Host (rund 30 Minuten)

**Wozu:** Mit der Browser-Emulation ist der Compile die Grenze des Servers
([CAPACITY_MODEL.md, Compile capacity](../CAPACITY_MODEL.md#compile-capacity-browser-emulation)).
Gemessen ist bisher nur auf einem Mac; der Referenz-Host ist die
Ubuntu/VBox-VM des Installers (8 vCPU, 11 GiB RAM, kein Swap).

**Vorbereitung** auf der VM, im Repository-Checkout des zu prüfenden Stands
(nicht in der laufenden Installation unter `/opt/unosim`; deren Dienst vorher
mit `sudo docker compose stop` anhalten):

```bash
npm ci
npm run build
npm run build:sandbox
```

**Messung:**

```bash
npm run capacity:calibrate -- --expected-users 30 --skip-classroom --skip-startup-tuning --max-duration 20 --output-dir capacity-test-results/p7-1-reference
```

**Ergebnis:** Der Abschnitt „Compile load (browser emulation)“ in
`capacity-test-results/p7-1-reference/capacity-calibration.md` (Tabelle mit
vier Zeilen). Datei an den Agenten geben oder die Tabelle mit Datum, Commit
und `nproc`/`free -g` in CAPACITY_MODEL.md unter „Compile capacity“ eintragen.

**Wenn etwas hakt**

| Symptom | Ursache und Abhilfe |
|---|---|
| Abbruch „requires a built application“ | `npm run build` fehlt |
| Backend startet nicht, Meldung nennt `unosim-compile-sandbox` | `npm run build:sandbox` fehlt oder ist fehlgeschlagen |
| Zeilen mit 503 | der Pool war länger als 30 s voll; Wert notieren, das ist ein Befund |

## Teil 4 – Aufnahmen an Nano, Mega 2560 und ATtiny85 (Klasse `hardware`)

**Ziel:** wie Teil 2, für die 33 Fälle der übrigen Boards (Nano 7, Mega 21,
ATtiny85 5; alle bisher `derived`). Werkzeug, Ablauf und Übernahme sind
dieselben wie in Teil 2; das Board steht im `case.json`, der Befehl ist
gleich. Die Aufnahme liest nur `Serial`. Deshalb übernimmt das Werkzeug diese
9 Fälle nicht, sie bleiben `derived`:

- 8 Fälle mit Zustandsprüfungen (`expectState`): Nano `it03-06`, `it04-03`;
  Mega `it03-04`, `it03-06`, `it04-03`, `mega_pins`, `mega_pwm_duty`;
  ATtiny85 `attiny_pwm_duty`.
- `mega_serial_ports`: Er nutzt `Serial1`–`Serial3`, die Aufnahme liest nur
  `Serial`.

**Fälle mit schnellen Flanken** (`mega_interrupts`: alle 5 ms;
`attiny_interrupts`: alle 20 ms) sind von Hand nicht zu treffen. Sie brauchen
einen Pulsgeber, zum Beispiel ein zweites Arduino, das die Flanken aus
`events` im `case.json` erzeugt. Ohne Pulsgeber bleiben sie `derived`.

### Nano und Mega 2560

Wie Teil 2, nur mit dem jeweiligen Board am USB. Ein Nano-Klon mit altem
Bootloader lädt nur mit `cpu=atmega328old`; dann den Fall **nicht**
übernehmen und dem Agenten melden (der Korpus nimmt den neuen Bootloader an).
Für die Analogfälle (`nano_adc_read`: A0, A5, A6, A7; `mega_adc_read`: A0, A7,
A8, A15) die Spannungen aus `events` mit Potentiometer oder Spannungsteiler
einstellen und messen, wie in Teil 2.

```sh
npm run record:hardware -- tests/fixtures/runtime-corpus/probes/nano_adc_read --port /dev/cu.usbserial-1410
npm run record:hardware -- tests/fixtures/runtime-corpus/probes/mega_memory_layout --port /dev/cu.usbmodem1101
```

### ATtiny85

**Was du brauchst:** einen ATtiny85 (DIP-8) auf dem Steckbrett, einen
ISP-Programmer (USBasp oder ein Uno mit dem Sketch „ArduinoISP“), einen
USB-Seriell-Adapter mit 5 V und DTR-Pin, einen Kondensator 100 nF und einen
Widerstand 10 kΩ.

**Aufbau:**

| ATtiny85 | Verbindung |
|---|---|
| Pin 8 (VCC), Pin 4 (GND) | 5 V und GND des Adapters (gemeinsame Masse mit dem Programmer) |
| Pin 1 (PB5, RESET) | 10 kΩ nach 5 V; 100 nF zum DTR des Adapters (Reset beim Öffnen des Ports, wie beim Uno) |
| Pin 5 (PB0, TX) | RX des Adapters |
| Pin 6 (PB1, RX) | TX des Adapters |
| Pins 1, 5, 6, 7 (PB5, PB0, PB1, PB2) | zum Programmieren an RESET, MOSI, MISO, SCK des Programmers |

**Einmal je Chip:** Ein neuer ATtiny85 läuft mit 1 MHz (Fuse CKDIV8). Die
Fuses für 8 MHz intern setzt:

```sh
arduino-cli burn-bootloader -b "ATTinyCore:avr:attinyx5:chip=85,clock=8internal" -P usbasp -p usb
# mit Uno als ISP: -P arduinoasisp -p /dev/cu.usbmodem1101
```

**Ein Fall:** Das Werkzeug lädt über den Programmer und nimmt am Adapter auf.
Bricht der Upload ab, stört der Adapter an PB0/PB1 (MOSI/MISO): seine
TX-Leitung zum Hochladen kurz abziehen, dann mit `--attempts 1` und ohne
Upload (`--no-upload`) aufnehmen.

```sh
npm run record:hardware -- tests/fixtures/runtime-corpus/probes/attiny_basics --port /dev/cu.usbserial-A10K --programmer usbasp --upload-port usb
```

Der interne Oszillator weicht ab Werk um bis zu ±10 % ab. Zeitwerte in
`attiny_basics` können dadurch außerhalb der Toleranz liegen, die Baudrate
ebenso (unlesbare Zeichen). Dann den Fall nicht übernehmen und dem Agenten
die Aufnahme geben, mit dem Hinweis auf den Takt; OSCCAL-Kalibrierung ist ein
eigener Schritt.

`attiny_adc_read` erwartet 2,51 V an A1 (Pin 7), 5 V an A2 (Pin 3) und 0,5 V
an A3 (Pin 2). `attiny_serial_echo` sendet der Adapter selbst.

## Teil 5 – Meldungen an avr8js (rund 30 Minuten)

UnoSim korrigiert vier Fehler von avr8js 0.21.1 im eigenen Code
([README des Pakets](../../packages/avr-emulator/README.md#avr8js-0211-corrections-and-known-differences)).
Wer sie meldet, hilft anderen Nutzern und macht ein späteres Update leichter.
Vorher in [wokwi/avr8js/issues](https://github.com/wokwi/avr8js/issues) nach
einem passenden Issue suchen. Am 2026-10-24 gab es keins; #136 (ADC im
Free-Running-Modus) und #178 (Timer 0 und `delay()` mit ATTinyCore) betreffen
andere Fehler. Je Fehler ein Issue, Texte zum Kopieren:

**1. USART: writing UCSRnB clears a pending RXC**

> avr8js 0.21.1 clears the RXC flag on every write to UCSRnB while RXEN stays
> set. On the ATmega328P only reading UDRn clears RXC (datasheet, UCSRnA). The
> Arduino core writes UCSR0B in every `Serial.write` (to enable UDRIE), so a
> byte that arrives while the sketch prints loses its interrupt, and the next
> byte overwrites it. Reproduce: a sketch that echoes input while printing
> continuously; send two bytes in quick succession; one is lost.

**2. ATtiny85 ADC: REFS2 is read at bit 3 instead of bit 4**

> On the ATtiny25/45/85, ADMUX has REFS1:0 at bits 7:6 and REFS2 at bit 4;
> bit 3 is MUX3 (datasheet, ADMUX). avr8js reads REFS2 at bit 3, so
> `analogReference(INTERNAL2V56)` (ATTinyCore) measures against VCC: 0.5 V on
> A3 reads 102 instead of 200.

**3. ATtiny85: INT0 and the pin-change interrupt share GIMSK and GIFR**

> GIMSK holds INT0 (bit 6) and PCIE (bit 5), GIFR holds INTF0 (bit 6) and PCIF
> (bit 5). avr8js hooks GIMSK only for the external interrupt and GIFR only for
> the pin-change interrupt. Setting PCIE does not raise a pending pin change,
> and writing 1 to INTF0 does not clear a pending INT0.

**4. ATtinyTimer1: PWM mode counts phase-correct and drives no OC1x with CTC1**

> In PWM mode (PWM1A or PWM1B) timer 1 of the ATtiny85 counts up from 0 to
> OCR1C and restarts at 0, with or without CTC1 (datasheet, "Timer/Counter1 in
> PWM Mode"). OC1x is set
> at 0 and cleared on a match with OCR1x (COM1x = 01/10), inverted with 11.
> `ATtinyTimer1` counts phase-correct when CTC1 is clear, and with CTC1 set (as
> ATTinyCore configures `analogWrite` on PB1/PB4) it drives no waveform at all:
> `updateCompPinNonPwm` is skipped because PWM is on, and `phasePwmCount` is
> not used because CTC1 is on.

Die Issue-Links in die Statusdatei eintragen (Zeile P6.2) oder dem Agenten geben.

## Teil 6 – README von UnoSim-Examples (rund 15 Minuten)

UnoSim liest seit P4.6 das optionale Manifestfeld `board`
([ExternalExamples-SSOT 7.1](../../ssot/ssot_function_definition_ExternalExamples.md)).
Das README des Beispiel-Repositorys nennt es noch nicht und beschreibt
außerdem nur die frühere Simulation. Vorschlag für einen PR in
`ttbombadil/unosim-examples`:

1. Nach dem Absatz über Headerdateien einfügen:

   > Every example may name its board in `manifest.json` with the optional
   > field `board`: `uno`, `nano`, `mega2560` or `attiny85`. Without it an
   > example fits every board. UnoSim versions that do not know an ID treat
   > it as not given; from version 2 on, UnoSim asks before it loads an
   > example for another board than the selected one. The examples of this
   > catalog are written for the Uno and carry no `board`.

2. Den Absatz „UnoSim does not run the sketch as Uno machine code …“ ersetzen
   durch:

   > UnoSim 1.x runs a sketch as a program on the server, so a few
   > observations differ from the hardware: `int` is 32 bits wide, `double`
   > 64 bits, and a float printed without a precision shows `2.5` instead of
   > `2.50`. UnoSim 2 emulates the board's microcontroller and matches the
   > hardware here ("Legacy" keeps the former behaviour). The examples avoid
   > these cases (overflow is shown with `byte`, floats are always printed
   > with a precision), so they behave the same in both versions. Keep it
   > that way in new examples; the UnoSim user guide lists all differences in
   > its section "Grenzen der Simulation".

Danach die Zeile P4.6 in der Statusdatei auf „erledigt“ setzen.

## Teil 7 – Vorabversion `v2.0.0-beta.1`

Die technischen Voraussetzungen erfüllt der Integrationsbranch (M1, P2.4,
P7.2; Plan 9.2). Ablauf und Abnahmekriterien stehen im
[Release-Runbook](../RELEASE_RUNBOOK.md#vorabversionen-und-v200-browser-emulation).
Ein Mensch entscheidet:

1. **Ob und wann:** Zeitpunkt der Pilot-Instanz (Semesterplanung).
2. **Version und CHANGELOG:** Der Abschnitt „Unreleased“ im CHANGELOG ist
   vollständig. Für die Beta wird er zu `## v2.0.0-beta.1 – <Datum>` und die
   Version gesetzt: `npm version 2.0.0-beta.1 --no-git-tag-version`. Ein
   vorbereiteter PR macht genau das.
3. **Tag nach dem Merge** von #344 und der Korrekturen #346–#350 (der
   CHANGELOG von `v2.0.0-beta.1` nennt sie) und grüner CI:

   ```sh
   git fetch origin && git checkout feature/browser-emulation && git pull --ff-only
   git tag -a v2.0.0-beta.1 -m "UnoSim v2.0.0-beta.1" && git push origin v2.0.0-beta.1
   ```

4. **Pilot-Instanz:** Images aus diesem Tag bauen, nach
   [INSTALL_SERVER.md, Pilot](../INSTALL_SERVER.md#browser-emulation-im-docker-profil-pilot)
   mit `UNOSIM_DEFAULT_RUNTIME=browser` neben der V1-Instanz ausrollen. Vor
   dem Unterricht: Teil 3 (Kapazität) auf dem Pilot-Host.
5. **Rückmeldungen** aus dem Unterricht als Issues; der Agent behebt sie in
   PRs gegen den Integrationsbranch.
