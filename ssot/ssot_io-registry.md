# Textbeschreibung:
Die Storyline ist so:

Im ino-File werden Pins verwendet. Die Verwendung der Pins soll in einer Tabelle dargestellt werden. Es geht um die Verwendung der Pins 0-13 und 14-19 (alias A0-A5) mit:
* pinMode (INPUT, OUTPUT, INPUT_PULLUP)
* digitalRead
* digitalWrite

Die IO-Registry ist eine Tabelle aller verwendeter Pins. Als Spalten existieren dann die Funktionen (siehe Bild).

# Aktualisierung der Tabelle:
Die Verwendung der Pins wird durch ein Parsing während der Eingabe ermittelt und dargestellt. Es kann aber auch sein, dass die Verwendung erst im laufenden Programm deutlich wird. Es soll soweit es geht das statische Parsing eingesetzt werden. Das Run-Time-Parsing wird zur Ergänzung der TAbelle verwendet.


# Übermittlung via Telemetry-Messages.
Die Übermittlung der Daten für die Tabelle (Backend->Frontend) soll soweit wie möglich gebündelt werden. Der Nutzer möchte in Echtzeit Einträge aus seiner programmierung sehen. Aber wenn ein Programm geladen wird, dann sollen die Telegramme mehrere Pinverwendungen gleichzeitig übermitteln.


# Der Auge-Button
Der Button toggelt eine kompakte und erweiterte Ansicht. Kompakt: grüne Haken bei Verwendung/ graue "-" bei Nicht-Verwendung. Erweitert: Bei Verwendung werden die Zeilennummern in der Tabelle eingetragen (für alle pinMode, digitalRead, digitalWrite). 


# Spezifikation: Hybrid IO-Registry
1. Kernkonzept & Mapping

Die IO-Registry erfasst die Verwendung der Hardware-Ressourcen eines Arduino Uno.

    Pin-Range: Digital 0–13 und Analog A0–A5 (intern als 14–19 gemappt).

    Identifikation: Pins werden im Frontend mit ihren Alias-Namen (RX, TX, ~, A0 etc.) dargestellt, im Backend jedoch über ihre numerische ID (0–19) eindeutig identifiziert.

2. Spaltenstruktur der Tabelle

Die Tabelle bildet die Interaktion zwischen Code und Hardware ab. Gemäß Screenshot existieren folgende Spalten:

    Pin: Anzeige des Namens/Labels (z.B. "A0").

    pinMode: Aktueller Modus (INPUT, OUTPUT, INPUT_PULLUP).

    digitalRead: Erfasst Lesezugriffe.

    digitalWrite: Erfasst Schreibzugriffe.

    analogRead: Erfasst analoge Eingänge (primär A0–A5).

    analogWrite: Erfasst PWM-Ausgaben (Pins mit ~-Markierung).

3. Hybrid-Parsing (Statisch & Dynamisch)

Das System nutzt zwei Quellen, um die Tabelle zu befüllen:

    Statisches Parsing (CodeParser): Scannt den Quellcode sofort bei Eingabe. Es erkennt explizite Aufrufe (z.B. pinMode(13, OUTPUT) oder digitalWrite(LED_BUILTIN, HIGH)) und löst Konstanten/Variablen auf.

    Run-Time Ergänzung: Während der Simulation werden Aufrufe erfasst, die statisch nicht eindeutig waren (z.B. dynamische Pin-Zuweisungen in Schleifen oder über berechnete Variablen).

    Konflikt-Management: Wenn statisches und dynamisches Parsing unterschiedliche Informationen liefern (siehe Screenshot bei A0: INPUT vs INPUT_PULLUP), muss die Registry dies als Konflikt markieren (rotes Fragezeichen/Warnung).

4. Telemetrie-Strategie (Effizienz)

Die Kommunikation zwischen Backend (Simulator) und Frontend (Tabelle) folgt dem Prinzip: "So viel wie nötig, so wenig wie möglich."

    Initialer Batch: Beim Laden eines Programms werden alle durch das statische Parsing ermittelten Daten in einer einzigen Nachricht gebündelt übertragen.

    Echtzeit-Updates: Während der Simulation sendet das Backend nur dann ein Telegramm, wenn ein Pin zum ersten Mal in einer neuen Funktion (z.B. das erste Mal digitalWrite) verwendet wird oder sich der pinMode ändert.

    Kein Spam: Wiederholte Aufrufe (z.B. in der loop()) triggern keine neuen Nachrichten, wenn sich die Tabelleneinträge dadurch nicht ändern.

5. UI-Interaktion: Der "Auge-Button"

Ein Toggle-Button in der UI (oben rechts im Screenshot) steuert die Detailtiefe:

    Kompakt-Ansicht (Default):

        Zustand: Binäre Anzeige (Aktiv/Inaktiv).

        Visualisierung: Grüne Haken für Nutzung, graue Striche (—) für Nicht-Nutzung.

    Erweiterte Ansicht:

        Zustand: Debug-Informationen.

        Visualisierung: Anstelle der Haken werden die Zeilennummern aus dem Code angezeigt, an denen die jeweilige Funktion aufgerufen wurde (z.B. "L12, L45").

# Testfälle

Nr,Code-Szenario,3. Ergebnis: Kompakt-Modus (Auge aus),4. Ergebnis: Erweitert-Modus (Auge an)
1,"pinMode(13, OUTPUT);","Pin 13, Spalte pinMode: Grüner Haken [✔]","Pin 13, Spalte pinMode: Zeigt L5"
2,digitalRead(A0);,"Pin A0 (14), Spalte digitalRead: Grüner Haken [✔]","Pin A0, Spalte digitalRead: Zeigt L10"
3,"for(int i=2; i<4; i++) {digitalWrite(i, HIGH); }","Pin 2 & 3, Spalte digitalWrite: Grüner Haken [✔]","Pin 2 & 3, Spalte digitalWrite: Zeigt L2"
4,"const int led = 12;digitalWrite(led, HIGH);","Pin 12, Spalte digitalWrite: Grüner Haken [✔]","Pin 12, Spalte digitalWrite: Zeigt L12"
5,"#define BTN A3pinMode(BTN, INPUT);","Pin A3 (17), Spalte pinMode: Grüner Haken [✔]","Pin A3, Spalte pinMode: Zeigt L2"
6,"void loop() {digitalWrite(9, HIGH); }",Pin 9: Einmaliger Haken [✔] (Kein Telemetrie-Spam/Flackern),Pin 9: Zeigt dauerhaft L2
7,"digitalRead(5); (L10)digitalWrite(5, LOW); (L20)",Pin 5: Haken [✔] in Spalte Read UND Write,Spalte Read: L10Spalte Write: L20
8,"Runtime-Erkennung:int p = random(0,5);digitalRead(p);","Pin erscheint live mit Haken [✔], sobald die Zeile ausgeführt wird.",Zeigt den Text Runtime oder Live (da keine statische Zeile existiert).
9,"Widerspruch (Read/Write):pinMode(A0, INPUT);digitalWrite(A0, HIGH);",Pin A0: Warnung durch Icon [!] (Modus passt nicht zur Aktion),"Warnung: Zeigt beide Zeilen L1, L2 zur Fehleranalyse."
10,"int pins[] = {7, 8};digitalRead(pins[1]);","Pin 8, Spalte digitalRead: Grüner Haken [✔]","Pin 8, Spalte digitalRead: Zeigt L2"
11,"Wechsel (pinMode):pinMode(13, OUTPUT); (L5)pinMode(13, INPUT); (L25)",Pin 13: Warnung durch Icon [!] (Mehrfache Definition),"Warnung: Zeigt beide Zeilen L5, L25 in der Spalte pinMode."