/*
 * IT03.1 – Text und Zahlen seriell ausgeben
 *
 * Lernziel:
 * Die serielle Verbindung starten und Texte sowie Zahlen mit print() und
 * println() in verschiedenen Formaten ausgeben.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Serielle Kommunikation mit PC einrichten“ und
 * „Ausgaben vom Arduino auf dem PC-Bildschirm“ (Formate BIN, HEX, Nachkommastellen).
 *
 * Beobachtung:
 * „Hallo Arduino!“ steht in einer Zeile. Danach erscheint 42 dezimal, binär
 * und hexadezimal sowie 3.14159 mit 2 und mit 4 Nachkommastellen.
 */

int zahl = 42;
float wert = 3.14159;

void setup() {
  Serial.begin(115200);

  Serial.print("Hallo ");
  Serial.println("Arduino!");

  Serial.print("dezimal:     ");
  Serial.println(zahl);
  Serial.print("binaer:      ");
  Serial.println(zahl, BIN);
  Serial.print("hexadezimal: ");
  Serial.println(zahl, HEX);

  Serial.print("2 Stellen:   ");
  Serial.println(wert, 2);
  Serial.print("4 Stellen:   ");
  Serial.println(wert, 4);
}

void loop() {
}

/*
 * Experimente:
 * 1. Ersetze den ersten Aufruf von print() durch println().
 * 2. Gib zahl zusätzlich mit dem Format OCT aus.
 * 3. Verschiebe die Ausgaben von setup() nach loop() und ergänze delay(1000);.
 *
 * Lernfragen:
 * 1. Was unterscheidet print() von println()?
 * 2. Warum muss Serial.begin() vor der ersten Ausgabe stehen?
 * 3. Wie oft werden die Texte ausgegeben und warum?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Texte und Zahlen seriell ausgeben und das Ausgabeformat wählen können."
afterFocus: free
focus:
  - id: print-und-println
    title: "print und println"
    objective: "Den Unterschied zwischen `print` und `println` erklären und die Zeilen der Ausgabe vorhersagen."
    questions:
      - kind: concept
        text: "Was unterscheidet `Serial.print` von `Serial.println`?"
      - kind: prediction
        text: "Wie sieht die erste Ausgabezeile aus, wenn der erste Aufruf von `Serial.print` durch `Serial.println` ersetzt wird?"
  - id: formate
    title: "Ausgabeformate"
    objective: "Die Wirkung des zweiten Parameters bei der Ausgabe erklären."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat `BIN` in `Serial.println(zahl, BIN)`?"
      - kind: application
        text: "Wie viele Nachkommastellen erscheinen bei `Serial.println(wert, 4)`?"
      - kind: transfer
        text: "Wie würdest du eine Spannung mit genau einer Nachkommastelle ausgeben?"
@end-unosim-tutor */
