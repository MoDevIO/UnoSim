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
   an; jede Datei erscheint als eigener Tab. **File → Format Code** (oder
   `Ctrl+Shift+F`, auf dem Mac `⇧⌘F`) rückt den Sketch nach seiner Struktur ein:
   Die Anweisung nach einem `if`, `else`, `for` oder `while` ohne geschweifte
   Klammern steht eine Ebene tiefer, und jedes `else` steht bei dem `if`, zu dem
   es gehört. Klammern fügt Format Code nicht hinzu; **Edit → Undo** stellt den
   Text davor wieder her.
2. Mit **Start** in der Kopfzeile kompilieren und die Simulation starten.
   Fehler beim Kompilieren erscheinen im Output Panel unter dem Editor.
3. Ausgaben von `Serial.print` erscheinen im **Serial Monitor**. Eingaben an den
   Sketch schickst du über das Feld **Send to Arduino...**.
4. Das **Board** zeigt den Zustand der Pins. Einen als `INPUT` genutzten Pin
   schaltest du per Klick um; analoge Eingänge stellst du mit einem
   Schieberegler ein.
5. Mit **Pause** hältst du die Simulation an, um Pins in Ruhe zu prüfen oder zu
   verändern; mit **Resume** läuft sie weiter. **Stop** beendet den Lauf.

Rot steht in der Oberfläche nur für Fehler, und jeder Fehler sagt auch in Worten,
was schiefging. Löschen und Leeren (etwa **Delete File** oder der Papierkorb
im Serial Monitor) sehen aus wie andere Aktionen; Löschen fragt weiter nach.
Ein Pin auf HIGH leuchtet auf dem Board gelb, und die Marke TX eines seriellen
Sendepins im I/O Registry ist violett – beides ist kein Fehler.

Ein Lauf endet automatisch nach seiner Laufzeit, die du unter
**Tools → Timeout** zwischen 5 Sekunden und 5 Minuten wählst. Eine pausierte
Simulation endet spätestens nach insgesamt 10 Minuten Pause.

## I/O Registry: Nutzung und Pin-Eigenschaften

Im Output Panel unter dem Editor öffnest du **I/O Registry**. Ein Doppelklick
auf diesen Tab vergrößert das Panel. Darunter stehen drei Ansichten:

- **Programmed Pins (n)** zeigt wie bisher die im Sketch und während des Laufs
  erkannten Pins und ihre Operationen. Die Zahl zählt verwendete Pins.
- **All Pins** zeigt dieselbe Nutzungstabelle für alle Signalpins des gewählten
  Boards. Unbenutzte Pins haben leere Operationsfelder.
- **Pin Infos** zeigt die Fähigkeiten des gewählten Boards unabhängig vom
  Sketch: Digital In/Out, Analog In, PWM Out, Bus Connections, Ext. IRQ,
  Pin Change und Timer. I²C, SPI/USI und Serial stehen mit ihrer Signalrolle in
  einer gemeinsamen Spalte. Die Suche findet zum Beispiel `SDA`, `SPI`,
  `PCINT` oder `A0`. Beim Scrollen bleiben Kopfzeile und Pin-Spalte sichtbar.

Der Auge-Button schaltet in den beiden Nutzungstabellen die Quellstellen ein.
Dateiname, Zeile, vollständiger Pfad im Tooltip und der Sprung zur richtigen
Datei bleiben erhalten. Alte Einträge mit einer Zeile ohne Dateipfad zeigen
weiterhin etwa `L23`; dynamische Funde ohne statische Stelle heißen `runtime`.
Der Zustand des Auge-Buttons bleibt beim Wechsel zwischen den drei Ansichten
erhalten. **Pin Infos** hat keine Quellstellen, weil es Hardware beschreibt.

PWM verwendet **8 Bit**, also 256 Stufen von 0 bis 255. Analogeingänge liefern
**10 Bit**, also 1024 Stufen von 0 bis 1023. Nano A6/A7 sind nur Analogeingänge.
Ein Sternchen erklärt Einschränkungen im Tooltip: insbesondere ATtiny PB5 als
reservierter RESET-Pin und einzelne Mega-Pins mit Pin-Change-Fähigkeit über
Register, die der Arduino-Core nicht über seine Helfer anbietet. Beim ATtiny
steht die Codeschreibweise unter dem Pin, etwa **PB4 — Code: 4 / A2**.
Versorgungs-, Masse- und Steuerkontakte stehen als reine Referenz am Ende;
sie sind keine zusätzlichen programmierbaren Pins und erhöhen die Zählung nicht.

Die Tabelle beschreibt Hardwarefähigkeiten, keine gleichzeitige Nutzbarkeit
aller mehrfach belegten Funktionen. Beim ATtiny gelten die angezeigten
USI/SPI-Rollen für den Master-Modus des gewählten Cores; ISP-Beschriftungen
können davon abweichen. **I²C, SPI und USI werden derzeit nicht simuliert.**
Die seriellen Peripherien werden im Browser-Modus nachgebildet; daraus folgt
keine Unterstützung beliebiger angeschlossener Geräte. Das bloße Anzeigen
einer Busfunktion verspricht deshalb keine Simulation eines Sensors.

## Arbeit sichern

Der Server speichert keine Sketches. Sichere deine Dateien mit
**File → Save All Files** und lade sie später mit **File → Load Files** wieder.

## Beispiele laden

**Examples** in der Kopfzeile (oder `Cmd/Ctrl+E`) öffnet die Beispielsammlung.
Ein Beispiel ersetzt den aktuellen Sketch und beginnt im Tutor einen neuen Dialog.
Bearbeitest du den Sketch, während ein Beispiel noch lädt, bleibt deine Änderung
erhalten und das Beispiel wird nicht übernommen. Nur die Sammlung anzusehen
ändert nichts an Sketch und Tutor-Dialog.

Die allgemeinen eingebauten Beispiele und die der externen Sammlung sind für den
**Uno** geschrieben. Ist ein anderes Board gewählt, fragt UnoSim vor dem Laden nach.
Auf Nano und Mega 2560 laufen sie ebenfalls; auf dem ATtiny85 fehlen ihre Pins,
und ihre 115200 Baud ergeben dort keine lesbare Ausgabe. Beispiele aus dem
Bibliotheksdialog nennen ihre geprüften Boards dort selbst.

**Built-in** enthält die eingebauten Beispiele. Diese Liste wird unabhängig
von **External** geladen und bleibt bedienbar, wenn die externe Quelle langsam
oder nicht erreichbar ist. Eine Statusmeldung erklärt den Ausfall; **Retry**
lädt nur die betroffene Liste neu. Ein erneuter Abruf verändert deinen Sketch
erst, wenn du ein Beispiel auswählst. Beide Listen benötigen die Verbindung
zum UnoSim-Server.

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
es darstellt: **Arduino UNO**, **Arduino Nano**, **Arduino Mega 2560** oder
**ATtiny85**. Die Wahl bleibt im Browser gespeichert; ein Wechsel stoppt einen
laufenden Sketch. Nano, Mega und ATtiny85 tragen den Hinweis „preview“: Sie
laufen in der Emulation, aber UnoSim hat ihre Ergebnisse noch nicht mit einem
echten Board verglichen.

| Board | Pins | PWM (`analogWrite`) | Analogeingänge | Serielle Schnittstellen |
|---|---|---|---|---|
| Uno | 0 bis 13, A0 bis A5 | 3, 5, 6, 9, 10, 11 | A0 bis A5 | `Serial` |
| Nano | wie der Uno, dazu A6 und A7 (nur analog) | wie der Uno | A0 bis A7 | `Serial` |
| Mega 2560 | 0 bis 53, A0 bis A15 | 2 bis 13 und 44 bis 46 | A0 bis A15 | `Serial`, `Serial1`, `Serial2`, `Serial3` |
| ATtiny85 | 0 bis 4 (PB0 bis PB4; PB5 ist RESET) | 0, 1, 4 | A0 bis A3 auf den Pins 5, 2, 4, 3 | `Serial` (in Software, auf 0 und 1) |

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

Beim **ATtiny85** gilt (Arduino-Core ATTinyCore 1.5.2, 8 MHz intern):

- Die Pins 0 bis 5 sind PB0 bis PB5. `A1` ist ein zweiter Name für Pin 2, `A2`
  für Pin 4, `A3` für Pin 3, `A0` für Pin 5; `analogRead(1)` liest wie
  `analogRead(A1)`. Auf dem Board heißt der Pin deshalb „2 (A1)“. `LED_BUILTIN`
  ist Pin 1.
- PB5 ist der RESET-Pin und als Ein- oder Ausgang nicht nutzbar; UnoSim warnt,
  wenn der Sketch ihn digital verwendet. `analogRead(A0)` funktioniert.
- Es gibt keine serielle Schnittstelle in Hardware. `Serial` sendet in Software
  auf Pin 0 (TX) und empfängt über den Analogkomparator auf Pin 1 (RX), mit
  einem Format von 8N1. Daraus folgen Grenzen des Boards, die UnoSim nachbildet:
  - **Halbduplex:** Während der Sketch sendet, empfängt er nichts. Lies
    Eingaben zuerst (`Serial.parseInt()`) und antworte danach; ein Sketch, der
    ständig ausgibt, verliert Eingaben.
  - Wer Pin 0 oder Pin 1 anders benutzt (auch für `analogWrite`), stört
    `Serial`; UnoSim warnt dann.
  - Die Baudrate steht in keinem Register. UnoSim erkennt sie an der Ausgabe;
    bis dahin gilt der Wert aus `Serial.begin()`. Verwende 9600: Bei 115200 Baud
    ist die Ausgabe oft unlesbar.
- Speicher: 8 KB Flash, 512 Byte SRAM, 512 Byte EEPROM.
- Die Legacy-Simulation gibt es nicht; `Serial1` bis `Serial3` auch nicht.

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

1. In der Tutor-Spalte (Absolventenhut-Symbol) auf **Tutor einrichten** klicken.
   Später erreichst du dieselbe Ansicht über das Menü **⋯ → Einstellungen**.
2. Den Key unter **API-Key** eintragen. Unter **Modell** kannst du ein Modell
   wählen; **Automatisch** ist die Voreinstellung und nimmt nur ein Modell, das
   der Betreiber dafür freigegeben hat. Ist keines verfügbar, meldet der Tutor
   das und bietet **Modell wählen** an. Darunter steht nach der ersten Antwort,
   welches Modell zuletzt geantwortet hat und ob **Automatisch** es gewählt hat.
3. Optional die **Startschwierigkeit** setzen: 1 ist sehr leicht, 100 sehr schwer.
   Der Tutor passt die Schwierigkeit danach selbst an; den aktuellen Wert zeigen
   ebenfalls die Einstellungen.
4. Mit **Übernehmen** zurück zum Tutor.

Der Key bleibt nur in diesem Browser-Tab im Arbeitsspeicher. Nach einem
Neuladen der Seite musst du ihn erneut eintragen. UnoSim speichert ihn nicht;
mit **Key löschen** entfernst du ihn sofort.

### Mit dem Tutor arbeiten

1. Mit **Frage starten** eine Lernfrage anfordern. Der Tutor zeigt immer nur
   die aktuelle Frage.
2. Die Antwort direkt darunter in das Feld **Antwort oder Rückfrage …** schreiben
   und mit **Senden** (oder Enter) abschicken.
3. Die Rückmeldung erscheint unter der Frage, bei einer bewerteten Antwort mit
   ihrer Verständnisbewertung (1–5 Sterne) direkt daneben. Ist die Frage damit
   beantwortet, bleibt sie mit deiner Antwort und der Rückmeldung stehen, bis du
   **Weiter zur nächsten Frage** wählst. Die Spalte zeigt dann den Anfang deiner
   Antwort und der Rückmeldung mit den Sternen; Weiter steht als Leiste am
   unteren Rand, hat den Fokus, und Enter genügt. Weiter schickt nichts ab und
   zählt nichts. Ist die Antwort noch nicht ausreichend, bleibt dieselbe Frage
   offen, und du kannst direkt weiter antworten, auch wenn du inzwischen den
   Code geändert hast.

Das Fragezeichen-Symbol neben dem Antwortfeld öffnet die **Hilfe zur aktuellen
Frage**. Das Öffnen selbst schickt nichts ab und zählt nichts. Keine Hilfe wird
bewertet, keine zählt als Verständnisnachweis:

- **Frage erklären**: Der Tutor erklärt, was gefragt ist, ohne die Antwort zu
  nennen. Du kannst auch einfach eine Rückfrage wie „Was ist mit dem ersten
  Durchlauf gemeint?“ eintippen.
- **Hinweis geben**: ein kurzer inhaltlicher Hinweis. „Ich weiß nicht“ im
  Antwortfeld bekommt ebenfalls einen Hinweis und zählt nicht als Antwort.
- **Frage überspringen**: erscheint nach zwei Erklärungen der Frage; der Tutor
  stellt dann eine andere Frage.
- **Musterantwort ansehen**: erscheint nach drei eigenen Antworten auf dieselbe
  Frage, aber nur, wenn die Lehrkraft eine geprüfte Musterantwort hinterlegt hat
  und dein Programm noch genau das geprüfte ist: Nur der Anfangswert, den die
  Frage selbst nennt (etwa `a = 200`), darf abweichen. Schon eine umformatierte
  Zeile oder ein anderes Board zählt als Änderung.

Wird eine dieser Hilfen gerade freigeschaltet, weist ein kurzer Satz unter der
Rückmeldung darauf hin. Unter **Wann gibt es weitere Hilfen?** steht, wie viele
Antworten bzw. Erklärungen bis zur Freigabe noch fehlen und ob eine geprüfte
Musterantwort vorliegt. Änderst du den Code, zählt die Frage von vorn.

Schlägt eine Anfrage fehl, bleibt dein Entwurf erhalten, und der Tutor bietet
die passende Aktion an, etwa **Erneut versuchen** oder **Modell wählen**.
**Erneut versuchen** schickt genau die fehlgeschlagene Anfrage noch einmal, mit
demselben Code und derselben Antwort. Hast du seitdem Code oder Antwort
geändert, entfällt diese Aktion; **Senden** schickt dann deine aktuelle Fassung.

**Verlauf** im Kopf der Tutor-Spalte zeigt frühere Fragen, deine Antworten, die
Rückmeldungen mit ihren Sternen und den Durchschnitt. Erklärungen, Hinweise,
übersprungene Fragen und Antworten nach der Musterantwort bleiben ohne Sterne.
**Zurück zur Frage** führt zum aktuellen Schritt; dein Entwurf bleibt erhalten.
**⋯ → Neue Lernrunde starten** beendet die aktuelle Frage, setzt Verlauf und
Lernstand zurück und stellt eine erste neue Frage. Wenn du ein Beispiel oder
eigene Dateien lädst, beginnt der Tutor ebenfalls neu; API-Key und Modell
bleiben erhalten.

Stammt dein Sketch aus einer Beispielsammlung mit Tutor-Inhalten, stellt der
Tutor zuerst die Fragen der Lehrkraft. Im **Verlauf** steht, wer gerade fragt
und wie viele Bereiche du verstanden hast:

- **Fokus der Lehrkraft**: Die Fragen der Lehrkraft laufen. Bei einer schwachen
  Antwort bekommst du einen Hinweis, und die Frage bleibt offen.
- **Fokus der Lehrkraft abgeschlossen**: Alle Bereiche sind verstanden, der
  freie Tutor macht weiter.
- **Fragen der Lehrkraft ausgeschöpft**: Die Fragen sind gestellt, aber nicht
  jeder Bereich ist verstanden. Die offenen Bereiche werden genannt, und der
  freie Tutor arbeitet weiter daran.
- **Fokus der Lehrkraft pausiert**: Dein Sketch enthält den Code des Beispiels
  nicht mehr. Der freie Tutor fragt dann zu deinem aktuellen Code.

Experimentieren ist erwünscht: Eine Lehrkraftfrage entfällt nur, wenn der Code,
nach dem sie fragt, nicht mehr im Sketch steht. Die Lehrkraftfragen sind fest.
Die Schwierigkeit wirkt daher auf Rückmeldungen und auf die Fragen des freien
Tutors.

Ohne Tutor-Inhalte – und auch, wenn GitHub gerade nicht erreichbar ist – arbeitet
er als freier Tutor direkt mit deinem Sketch.

### Tutor-Diagnose im Debug-Tab

Im Debug-Modus zeigt der Ausgabebereich unter **Debug** auch Tutor-Ereignisse.
Die Kategorie **Tutor**, die Suche nach Anfrage-ID und die Filter für Schritt,
Ergebnis und Grund helfen beim Nachvollziehen eines Testlaufs. **Details** öffnet
die geprüften Metadaten; **Copy debug messages** kopiert alle zum Filter passenden
gepufferten Einträge. Der angezeigte Umfang kann kleiner sein als der Kopierumfang.

Die Meldungen unterscheiden unter anderem eine nicht gelieferte Grafik, eine
Ablehnung, das Zurückhalten bis **Weiter** und die tatsächliche SVG-Darstellung.
Für serverseitige Schritte muss der Betreiber die Tutor-Diagnose zusätzlich
freigeben; andernfalls ist die Spur als unvollständig gekennzeichnet. Zugangsdaten,
Dialogtexte, Sketches und Grafikquelltext werden nicht in diese Meldungen übernommen.
Die Einträge bleiben im Arbeitsspeicher. Compile/Upload erhält Tutor-Einträge;
**Clear debug messages** und ein Neuladen entfernen sie.

#### Tutor-Testlauf zur Prüfung kopieren

In der Kategorie **Tutor** zeigt der Debug-Tab zusätzlich den **Tutor review**:
einen Mitschnitt deines Testlaufs mit gestellten Fragen, deinen Antworten,
Feedback, Bewertungen und dem jeweils gesendeten Sketch einschließlich Headern
und Board. Die Übersicht nennt Schritte, Kontextstände, Modelle, Grafiken und ob
der Mitschnitt vollständig ist; jeder Schritt lässt sich als Text aufklappen.

**Copy Tutor review** kopiert den gewählten Mitschnitt mit einem Klick vollständig,
unabhängig von Filtern und vom Meldungspuffer. Daneben steht die Größe. Der Text
beginnt mit einem lesbaren Protokoll, danach folgen Code, Legende und ein
JSON-Teil; das [Exportformat](tutor-review-format.md) beschreibt ihn und enthält
eine Prüfcheckliste. **Start new Tutor review** beginnt einen neuen Mitschnitt.

Der Mitschnitt enthält Gesprächsinhalte und Code. Er bleibt nur im Speicher
dieses Browser-Tabs, bis du **Clear debug messages** wählst oder neu lädst; mit
dem Kopieren gibst du ihn bewusst weiter. Dein API-Key wird vor dem Speichern
auch aus Texten entfernt. Debug-Modus aus beendet die Aufnahme; erneutes
Einschalten beginnt einen neuen Mitschnitt.

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
des Mikrocontrollers (ATmega328P, beim Mega 2560 der ATmega2560, beim ATtiny85 der ATtiny85) im Browser,
der den Maschinencode des Sketches ausführt, nicht ein Programm für den
UnoSim-Server. Datentypen, Überläufe, `millis()` und `delay()` verhalten sich
deshalb wie auf dem gewählten Board. Wer die frühere Art der Simulation braucht, wählt
unter **File → Settings → Simulation engine** „Legacy“ (siehe unten). Das gibt es nur für den Uno; bei Nano, Mega 2560 und ATtiny85 ist die Einstellung sichtbar, aber fest auf „Emulation“ gesetzt und nennt den Grund.

Die Emulation ist ein Modell. Sie weicht in diesen Punkten vom echten Board ab:

| Thema | Modell in UnoSim |
|---|---|
| Offener Eingang (`INPUT`, nicht gesetzt) | liest LOW; am echten Board ist der Pegel undefiniert |
| `INPUT_PULLUP` | liest HIGH, bis du den Pin auf LOW setzt |
| Pegel, den du am Board setzt | gilt, bis der Sketch den Pin auf `OUTPUT` schaltet |
| Analoger Eingang | Der Regler ist eine Spannung von 0 bis 5 V in 1024 Stufen; mit der Standardreferenz liefert `analogRead()` genau den Reglerwert. Am Pin `AREF` (`EXTERNAL`) liegen 5 V, weil dort am Board nichts angeschlossen ist |
| PWM | UnoSim zeigt das Tastverhältnis (0 bis 255), keine Signalform |
| Serial | Der Empfangspuffer hat 64 Byte wie am Uno (beim Mega je Schnittstelle, beim ATtiny85 32 Byte wie im Core); was der Sketch nicht abholt, geht verloren. Text, den du **vor** `Serial.begin()` sendest, geht verloren wie am echten Board; UnoSim meldet das im Serial Monitor mit einer eigenen Zeile. Gesendeter Text endet mit dem Zeilenende (Code 10), wie in der Arduino IDE mit „New Line“ |
| Zeit | exakt in simulierter Zeit. Ist dein Gerät zu langsam, laufen Uhr und Simulation langsamer als die Wanduhr; die Kopfzeile zeigt dann einen Echtzeitfaktor unter 1. Der Timeout zählt Wanduhrzeit: Bei Faktor 0,5 endet ein 30-Sekunden-Lauf nach etwa 15 simulierten Sekunden |
| Pause | hält auch `millis()` an |
| Überlauf mit `int` und `long` | In C++ ist der Überlauf vorzeichenbehafteter Typen undefiniert. UnoSim zeigt, was der Code mit dem Compiler des Uno auf dem Board tut, z. B. `32767 + 1` ergibt −32768. Das ist keine allgemeine C++-Garantie: Mit Optimierung kann derselbe Quelltext anders laufen, auf dem echten Uno genauso |
| EEPROM | bleibt im Browser-Tab je Board erhalten, solange du die Seite nicht neu lädst; ein neuer Tab beginnt gelöscht |
| I²C, SPI, USI | Die Hardware-Pinbelegung steht in Pin Infos; die Busperipherien und angeschlossene Geräte werden derzeit nicht simuliert |
| Speicher | Größen und Adressen wie am Board (2 KB SRAM, beim Mega 8 KB, beim ATtiny85 512 Byte). UnoSim meldet nur wenige Fälle, etwa einen Stack, der in die globalen Variablen oder den Heap hineinwächst, wenn die Prüfung ihn erfasst; ein Schreibzugriff über eine Arraygrenze fällt wie am echten Board nicht auf und zeigt sich nur in seinen Folgen |
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

Gesendeter Text im Serial Monitor endet mit dem Zeilenende, das du dort wählst:
„Newline“ (Code 10, Voreinstellung), „Carriage return“ (Code 13), „Both NL & CR“
(13 und 10) oder „No line ending“.

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
