/*
 * IT03.7 – Eine Zeitdifferenz messen
 *
 * Lernziel:
 * Mit millis() zwei Zeitpunkte erfassen und daraus eine Dauer berechnen.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Zeit in Millisekunden abfragen mit millis“,
 * „Zeit ausgeben“ und „Zeitdifferenz messen“.
 *
 * Beobachtung:
 * Die Startzeit wächst von Ausgabe zu Ausgabe. Die gemessene Dauer beträgt
 * ungefähr 587 ms – so lange dauert delay(587).
 */

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned long zeit1 = millis();
  delay(587);
  unsigned long zeit2 = millis();
  unsigned long dauer = zeit2 - zeit1;

  Serial.print("Startzeit: ");
  Serial.print(zeit1);
  Serial.print(" ms, Dauer: ");
  Serial.print(dauer);
  Serial.println(" ms");

  delay(1000);
}

/*
 * Experimente:
 * 1. Ersetze delay(587) durch drei Ausgaben mit einem langen Text. Wie lange
 *    dauert die Ausgabe?
 * 2. Stelle die Baudrate auf 9600 und wiederhole das erste Experiment.
 * 3. Gib zusätzlich die Startzeit in Sekunden aus.
 *
 * Lernfragen:
 * 1. In welcher Einheit liefert millis() die Zeit?
 * 2. Warum eignet sich unsigned long für Zeitwerte?
 * 3. Warum steigt die Startzeit pro Durchlauf um etwas mehr als 1587 ms?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen mit millis() eine Zeitdifferenz messen können."
  - "Sie sollen den Datentyp für Zeitwerte begründen können."
afterFocus: free
focus:
  - id: zeitdifferenz
    title: "Zeitdifferenz"
    objective: "Erklären, wie aus zwei Zeitpunkten eine Dauer berechnet wird."
    questions:
      - kind: recall
        text: "In welcher Einheit liefert `millis()` die Zeit?"
      - kind: concept
        text: "Warum ergibt `zeit2 - zeit1` die Dauer von `delay(587)`?"
  - id: datentyp
    title: "Datentyp für Zeiten"
    objective: "Den Datentyp `unsigned long` für Zeitwerte begründen."
    questions:
      - kind: concept
        text: "Warum eignet sich `unsigned long` für `zeit1` und `zeit2`?"
      - kind: prediction
        text: "Um wie viel ändert sich die Startzeit ungefähr von einer Ausgabe zur nächsten?"
      - kind: transfer
        text: "Wie würdest du messen, wie lange eine Ausgabe mit `Serial.print` dauert?"
@end-unosim-tutor */
