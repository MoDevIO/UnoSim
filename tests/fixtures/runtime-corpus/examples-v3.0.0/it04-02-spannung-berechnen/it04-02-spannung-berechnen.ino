/*
 * IT04.2 – Einen Messwert in Volt umrechnen
 *
 * Lernziel:
 * Den digitalisierten Wert eines Analogeingangs in eine Spannung umrechnen
 * und dabei Kommazahlen verwenden.
 *
 * Bezug zu den Unterlagen:
 * IT04, Folien „Was sind analoge Eingänge?“ (567/1024*5V = 2,77 V) und
 * „analogRead - Beispiel“ (Umrechnung in Volt).
 *
 * Beobachtung:
 * Zu jedem Messwert erscheint die Spannung, z. B. „567 (2.77 V)“.
 */

const byte PIN_SENSOR = A0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned int messwert = analogRead(PIN_SENSOR);
  float spannung = messwert / 1024.0 * 5.0;

  Serial.print(messwert);
  Serial.print(" (");
  Serial.print(spannung, 2);
  Serial.println(" V)");
  delay(500);
}

/*
 * Experimente:
 * 1. Stelle A0 auf 567 und prüfe die Rechnung der Folie.
 * 2. Ersetze 1024.0 durch 1024 und 5.0 durch 5. Was erscheint jetzt und warum?
 * 3. Welche Spannung gehört zum Messwert 700? Prüfe deine Rechnung im Simulator.
 *
 * Lernfragen:
 * 1. Warum wird durch 1024 geteilt und mit 5 multipliziert?
 * 2. Warum wird für spannung der Datentyp float verwendet?
 * 3. Warum hängt das Ergebnis im zweiten Experiment davon ab, ob 1024.0 oder
 *    1024 geschrieben wird?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen Rohwert in eine Spannung umrechnen können."
  - "Sie sollen erklären können, warum für die Rechnung Kommazahlen nötig sind."
afterFocus: free
focus:
  - id: umrechnung
    title: "Umrechnung in Volt"
    objective: "Die Formel erklären und eine Spannung zu einem Messwert berechnen."
    questions:
      - kind: concept
        text: "Warum wird `messwert` durch `1024.0` geteilt und mit `5.0` multipliziert?"
      - kind: application
        text: "Welche Spannung gehört zum Messwert 700?"
  - id: kommazahlen
    title: "Kommazahlen"
    objective: "Begründen, warum `float` und Kommazahl-Konstanten nötig sind."
    questions:
      - kind: concept
        text: "Warum wird für `spannung` der Datentyp `float` verwendet?"
      - kind: prediction
        text: "Welche Spannung wird angezeigt, wenn `1024.0` durch 1024 und `5.0` durch 5 ersetzt werden?"
@end-unosim-tutor */
