/*
 * IT06.3 – Zählschleifen mit for
 *
 * Lernziel:
 * Startwert, Abbruchbedingung und Schrittweite einer for-Schleife festlegen,
 * auch für Schrittweite 2 und für das Rückwärtszählen.
 *
 * Bezug zu den Unterlagen:
 * IT06, Folien „Zählschleife - for“ (Syntax, Erläuterungen, geänderte
 * Laufgrenzen, Schrittweite 2, Schleife zählt runter).
 *
 * Beobachtung:
 * Drei Zeilen: 0 bis 9, die geraden Zahlen von 0 bis 18 und 7 bis 0.
 */

void setup() {
  Serial.begin(115200);

  for (byte i = 0; i < 10; i++) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();

  for (byte i = 0; i < 20; i = i + 2) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();

  for (int i = 7; i >= 0; i--) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();
}

void loop() {
}

/*
 * Experimente:
 * 1. Lasse die erste Schleife von 1 bis 10 laufen.
 * 2. Zähle in der zweiten Schleife in Dreierschritten.
 * 3. Ersetze in der dritten Schleife int durch byte. Was geschieht?
 *    (Simulation danach stoppen.)
 *
 * Lernfragen:
 * 1. Welche drei Angaben stehen im Kopf einer for-Schleife?
 * 2. Wie oft wird der Block der ersten Schleife ausgeführt?
 * 3. Warum endet die dritte Schleife mit byte nie?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen for-Schleifen mit verschiedenen Laufgrenzen und Schrittweiten formulieren können."
  - "Sie sollen erklären können, warum der Datentyp der Laufvariablen wichtig ist."
afterFocus: free
focus:
  - id: schleifenkopf
    title: "Der Schleifenkopf"
    objective: "Die drei Angaben im Schleifenkopf benennen und die Zahl der Durchläufe bestimmen."
    questions:
      - kind: recall
        text: "Welche drei Angaben stehen im Kopf von `for (byte i = 0; i < 10; i++)`?"
      - kind: prediction
        text: "Welche Zahlen gibt die Schleife mit `i = i + 2` aus?"
  - id: rueckwaerts
    title: "Rückwärts zählen"
    objective: "Die Bedingung beim Rückwärtszählen und den Datentyp der Laufvariablen begründen."
    questions:
      - kind: concept
        text: "Warum endet die Schleife mit `i--` nach der Ausgabe von 0?"
      - kind: prediction
        text: "Was geschieht, wenn `i` in der Schleife mit `i >= 0` vom Typ `byte` ist?"
      - kind: transfer
        text: "Wie würdest du eine Schleife schreiben, die von 20 in Zweierschritten bis 2 herunterzählt?"
@end-unosim-tutor */
