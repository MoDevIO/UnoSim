# UnoSim benutzen

Diese Anleitung richtet sich an Lernende und Lehrkräfte, die UnoSim im Browser
verwenden. Installation und Betrieb beschreibt die
[Dokumentationsübersicht](README.md). Die Oberfläche
ist englisch; die Menünamen stehen hier deshalb in der Originalschreibweise.

## Überblick

UnoSim simuliert einen Arduino Uno im Browser. Du schreibst einen Sketch,
kompilierst ihn auf dem UnoSim-Server und siehst die Ausgabe im Serial Monitor
und am Board. Du brauchst dafür keine Hardware und keine Installation.

## Einen Sketch schreiben und starten

1. Den Code im Editor schreiben. Weitere Dateien legst du mit **File → New File**
   an; jede Datei erscheint als eigener Tab.
2. Mit **Start** in der Kopfzeile kompilieren und die Simulation starten.
   Fehler beim Kompilieren erscheinen im Output Panel unter dem Editor.
3. Ausgaben von `Serial.print` erscheinen im **Serial Monitor**. Eingaben an den
   Sketch schickst du über das Feld **Send to Arduino...**.
4. Das **Board** zeigt den Zustand der Pins. Einen als `INPUT` genutzten Pin
   schaltest du per Klick um; analoge Eingänge stellst du mit einem
   Schieberegler ein.
5. Mit **Pause** hältst du die Simulation an, um Pins in Ruhe zu prüfen oder zu
   verändern; mit **Resume** läuft sie weiter. **Stop** beendet den Lauf.

Ein Lauf endet automatisch nach seiner Laufzeit, die du unter
**Tools → Timeout** zwischen 5 Sekunden und 5 Minuten wählst. Eine pausierte
Simulation endet spätestens nach insgesamt 10 Minuten Pause.

## Arbeit sichern

Der Server speichert keine Sketches. Sichere deine Dateien mit
**File → Save All Files** und lade sie später mit **File → Load Files** wieder.

## Beispiele laden

**Examples** in der Kopfzeile (oder `Cmd/Ctrl+E`) öffnet die Beispielsammlung.
Ein Beispiel ersetzt nach Rückfrage den aktuellen Sketch.

Lehrkräfte können für ihren Browser eine eigene Beispielsammlung wählen:

1. **File → Settings** öffnen, Abschnitt **External Examples**.
2. Unter **Repository** ein öffentliches GitHub-Repository eintragen
   (`owner/repository` oder die GitHub-URL), unter **Ref** einen Branch oder
   Tag (Standard `main`).
3. **Validate** prüft die Sammlung, **Apply** übernimmt sie.
   **Reset to default** kehrt zur Sammlung des Servers zurück.

Die Auswahl gilt nur für diesen Browser und ändert nichts an der Einstellung
des Servers. Wie man eine eigene Sammlung samt Tutor-Inhalten aufbaut,
beschreibt das
[README von UnoSim-Examples](https://github.com/ttbombadil/UnoSim-Examples#course-content-and-tutor-authoring).

## Board wählen

Unter **Tools → Board** wählst du das Board, für das UnoSim kompiliert und das
es darstellt: **Arduino UNO**, **Arduino Nano** oder **Arduino Mega 2560**. Die
Wahl bleibt im Browser gespeichert; ein Wechsel stoppt einen laufenden Sketch.
Nano und Mega tragen den Hinweis „preview“: Sie laufen in der Emulation, aber
UnoSim hat ihre Ergebnisse noch nicht mit einem echten Board verglichen.

| Board | Pins | PWM (`analogWrite`) | Analogeingänge | Serielle Schnittstellen |
|---|---|---|---|---|
| Uno | 0 bis 13, A0 bis A5 | 3, 5, 6, 9, 10, 11 | A0 bis A5 | `Serial` |
| Nano | wie der Uno, dazu A6 und A7 (nur analog) | wie der Uno | A0 bis A7 | `Serial` |
| Mega 2560 | 0 bis 53, A0 bis A15 | 2 bis 13 und 44 bis 46 | A0 bis A15 | `Serial`, `Serial1`, `Serial2`, `Serial3` |

Beim **Mega 2560** gilt:

- Die Pinnummern sind die des Boards: `A0` ist Pin 54, `A15` ist Pin 69. Ein
  Sketch, der die Pinnummer eines Analogeingangs ausgibt, zeigt hier 54 bis 69
  statt 14 bis 19.
- Der Mega hat vier serielle Schnittstellen. Der Serial Monitor zeigt eine
  davon; oben wählst du **Serial**, **Serial1**, **Serial2** oder **Serial3**.
  Das Eingabefeld sendet an die gezeigte Schnittstelle, „Clear“ leert sie. Der
  Plotter zeigt immer `Serial`. Systemzeilen wie „Simulation stopped“ erscheinen
  in jeder Schnittstelle.
- Die externen Interrupts `INT0` bis `INT5` (Pins 21, 20, 19, 18, 2, 3) und die
  Pin-Change-Interrupts gibt es; `attachInterrupt()` funktioniert wie am Board.
- Speicher: 256 KB Flash, 8 KB SRAM, 4 KB EEPROM. Wer mehr als 64 KB
  Programmdaten im Flash ablegt, liest sie mit den „far“-Funktionen
  (`pgm_read_byte_far`), wie am Board. Liegen die Pin-Tabellen des Arduino-Cores
  durch große Datenmengen oberhalb von 64 KB, findet der Core sie nicht mehr;
  das passiert am echten Mega ebenso.
- Die frühere Simulation auf dem Server (Legacy) gibt es nur für den Uno.
- Beispiele, die für den Uno geschrieben sind, laufen auf dem Mega, solange sie
  keine Pinnummer über 13 voraussetzen (`A0` bis `A5` heißen dort anders
  nummeriert, siehe oben).

## Der Tutor

Der Tutor stellt Lernfragen zu deinem aktuellen Sketch und gibt Rückmeldung auf
deine Antworten. Er schreibt keine fertige Lösung.

### Tutor einschalten

Der Tutor ist Teil des neuen Arbeitsbereichs, der noch als experimentell gilt:

1. **File → Settings** öffnen.
2. Unter **Workspace & Interaction** die Option
   **Experimental Workspace Layout** einschalten.

Code, Simulation und Tutor erscheinen dann als eigene Spalten, die du einzeln
ein- und ausblenden kannst.

### API-Key eintragen

Der Tutor nutzt ein Sprachmodell über KI:connect.nrw und braucht dafür deinen
**persönlichen KI:connect-API-Key**. Den Key bekommst du über deine Schule oder
Hochschule. Ein anderer Anbieter oder ein anderer Zugang ist derzeit nicht
möglich; ohne KI:connect-Key steht der Tutor nicht zur Verfügung. Die
Unterstützung weiterer Anbieter ist in
[Issue #243](https://github.com/MoDevIO/UnoSim/issues/243) geplant.

1. In der Tutor-Spalte auf das Schlüssel-Symbol klicken
   (**API key missing**).
2. Den Key unter **API key** eintragen. Unter **Model** kannst du ein Modell
   wählen; **Automatic** ist die Voreinstellung.
3. Optional die **Start difficulty** setzen: 1 ist sehr leicht, 100 sehr schwer.
   Der Tutor passt die Schwierigkeit danach selbst an.

Der Key bleibt nur in diesem Browser-Tab im Arbeitsspeicher. Nach einem
Neuladen der Seite musst du ihn erneut eintragen. UnoSim speichert ihn nicht.

### Mit dem Tutor arbeiten

1. Mit dem Fragezeichen-Symbol in der Tutor-Spalte eine neue Lernfrage anfordern.
2. Die Antwort in das Feld **Your answer …** schreiben und mit
   **Send answer** abschicken.
3. Der Tutor bewertet dein Verständnis und stellt genau eine Folgefrage.

Stammt dein Sketch aus einer Beispielsammlung mit Tutor-Inhalten, folgt der
Tutor dem dort hinterlegten Lernpfad. Sonst – und auch, wenn GitHub gerade
nicht erreichbar ist – arbeitet er als freier Tutor direkt mit deinem Sketch.

## Einstellungen

Unter **File → Settings** findest du außerdem:

- **UI Font Size**: Schriftgröße von Oberfläche und Editor (S bis XXL),
- **Arduino Color**: Farbe des Boards,
- **Pin Monitor**: Pin-Übersicht über dem Board,
- **Toast Duration**: Anzeigedauer von Hinweisen.

## Grenzen der Simulation

UnoSim prüft jeden Sketch zuerst mit dem echten Arduino-Compiler für das
gewählte Board (Standard: Uno). Was hier kompiliert, kompiliert also auch auf der
Hardware. Danach läuft das fertige Programm in der **Emulation**: ein Nachbau
des Mikrocontrollers (ATmega328P, beim Mega 2560 der ATmega2560) im Browser,
der den Maschinencode des Sketches ausführt, nicht ein Programm für den
UnoSim-Server. Datentypen, Überläufe, `millis()` und `delay()` verhalten sich
deshalb wie auf dem Uno. Wer die frühere Art der Simulation braucht, wählt
unter **File → Settings → Simulation engine** „Legacy“ (siehe unten).

Die Emulation ist ein Modell. Sie weicht in diesen Punkten vom echten Board ab:

| Thema | Modell in UnoSim |
|---|---|
| Offener Eingang (`INPUT`, nicht gesetzt) | liest LOW; am echten Board ist der Pegel undefiniert |
| `INPUT_PULLUP` | liest HIGH, bis du den Pin auf LOW setzt |
| Pegel, den du am Board setzt | gilt, bis der Sketch den Pin auf `OUTPUT` schaltet |
| Analoger Eingang | Der Regler ist eine Spannung von 0 bis 5 V in 1024 Stufen; mit der Standardreferenz liefert `analogRead()` genau den Reglerwert. Am Pin `AREF` (`EXTERNAL`) liegen 5 V, weil dort am Board nichts angeschlossen ist |
| PWM | UnoSim zeigt das Tastverhältnis (0 bis 255), keine Signalform |
| Serial | Der Empfangspuffer hat 64 Byte wie am Uno (beim Mega je Schnittstelle); was der Sketch nicht abholt, geht verloren. Text, den du **vor** `Serial.begin()` sendest, geht verloren wie am echten Board; UnoSim meldet das im Serial Monitor mit einer eigenen Zeile. Gesendeter Text endet mit dem Zeilenende (Code 10), wie in der Arduino IDE mit „New Line“ |
| Zeit | exakt in simulierter Zeit. Ist dein Gerät zu langsam, laufen Uhr und Simulation langsamer als die Wanduhr; die Kopfzeile zeigt dann einen Echtzeitfaktor unter 1. Der Timeout zählt Wanduhrzeit: Bei Faktor 0,5 endet ein 30-Sekunden-Lauf nach etwa 15 simulierten Sekunden |
| Pause | hält auch `millis()` an |
| Überlauf mit `int` und `long` | In C++ ist der Überlauf vorzeichenbehafteter Typen undefiniert. UnoSim zeigt, was der Code mit dem Compiler des Uno auf dem Board tut, z. B. `32767 + 1` ergibt −32768. Das ist keine allgemeine C++-Garantie: Mit Optimierung kann derselbe Quelltext anders laufen, auf dem echten Uno genauso |
| EEPROM | bleibt im Browser-Tab je Board erhalten, solange du die Seite nicht neu lädst; ein neuer Tab beginnt gelöscht |
| I²C, SPI | Die Bausteine sind vorhanden, aber es hängt kein Gerät am Bus |
| Speicher | Größen und Adressen wie am Board (2 KB SRAM, beim Mega 8 KB). UnoSim meldet nur wenige Fälle, etwa einen Stack, der in die globalen Variablen oder den Heap hineinwächst, wenn die Prüfung ihn erfasst; ein Schreibzugriff über eine Arraygrenze fällt wie am echten Board nicht auf und zeigt sich nur in seinen Folgen |
| `random()` | Die Zahlenfolge ist die des Uno (`randomSeed` und Startwert wie am Board) |

Was das für deine Programme bedeutet:

- Programme, die von Wertebereichen oder Rechenzeit abhängen, verhalten sich in
  der Emulation wie auf dem Uno. Prüfe sie bei Timing auf dem Mikrosekundenbereich
  trotzdem auf einem echten Board: Die Zeit stimmt in der Emulation, aber
  Bauteile, Leitungen und Störungen gibt es nicht.
- Unverbundene Eingänge zeigen im Board eine zufällige Spannung; in UnoSim
  liest ein offener Eingang immer LOW. Schalte Eingänge mit `INPUT_PULLUP`
  oder einem Widerstand, damit sich dein Programm auf dem Board gleich verhält.
- Die Emulation läuft im Browser. Reißt die Verbindung zum Server ab, läuft ein
  gestarteter Lauf weiter; Kompilieren, Beispiele und der Tutor brauchen den
  Server.

Gesendeter Text im Serial Monitor endet immer mit dem Zeilenende (Code 10).

### Legacy: Simulation auf dem Server

Wählst du „Legacy“ oder bietet der Server die Emulation nicht an, läuft der
Sketch als Programm für den UnoSim-Server. Dann gelten die früheren
Abweichungen:

| Thema | Arduino Uno | UnoSim (Legacy) |
|---|---|---|
| Größe von `int` und `unsigned int` | 16 Bit: `int` reicht von −32768 bis 32767 | 32 Bit: `32767 + 1` ergibt 32768 statt −32768 |
| Größe von `long` | 32 Bit | 64 Bit |
| Größe von `double` | 32 Bit, gleich `float` | 64 Bit, rechnet genauer |
| `sizeof` | z. B. `sizeof(int)` = 2 | zeigt die Größen des Servers, z. B. 4 |
| `Serial.print` einer Kommazahl ohne Stellenangabe | `2.50` (immer 2 Nachkommastellen) | `2.5` |
| `Serial.parseInt()` ohne Eingabe | wartet 1 Sekunde, liefert dann 0 | liefert sofort 0 |
| Geschwindigkeit | 16 MHz | anders: Wie oft `loop()` pro Sekunde läuft, weicht ab. `millis()` und `delay()` stimmen. |
| Arbeitsspeicher | 2 KB | praktisch unbegrenzt: Ein großes Array kann hier laufen und auf dem Uno abstürzen |
| `random()` | feste Zahlenfolge des Uno | andere Zahlenfolge |

Überläufe beobachtest du in Legacy zuverlässig nur mit `byte` (0 bis 255), und
Kommazahlen gibst du mit Stellenzahl aus, z. B. `Serial.println(wert, 2)`.

## Wenn etwas nicht klappt

| Meldung oder Verhalten | Ursache und Lösung |
|---|---|
| **Server connection required** | Der Browser erreicht den UnoSim-Server nicht. Verbindung prüfen und die Seite neu laden. |
| **Waiting for compile slot** oder **Waiting for simulation slot** | Viele Nutzer kompilieren oder simulieren gleichzeitig; UnoSim startet deinen Lauf, sobald ein Platz frei ist. |
| **Enter your personal Tutor API key first.** | Es ist noch kein Key eingetragen, oder die Seite wurde neu geladen. |
| **The Tutor access was rejected.** | Der Key ist ungültig oder abgelaufen. |
| Fehler im Output Panel nach **Start** | Der Sketch kompiliert nicht. Die Zeilenangabe in der Meldung zeigt auf die Fehlerstelle. |
