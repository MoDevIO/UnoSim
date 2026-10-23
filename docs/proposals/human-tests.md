# Messungen und Aufnahmen durch Menschen

> **Nicht normativ.** Anleitung für die Arbeitspakete, die eine Person mit
> Geräten durchführen muss (P0.3 und die Klasse `hardware` von P1.14) im Rahmen
> von [browser-emulation-plan.md](browser-emulation-plan.md). Wird mit dem Plan
> gelöscht. Ergebnisse gehen an den Agenten oder in die Statusdatei
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
