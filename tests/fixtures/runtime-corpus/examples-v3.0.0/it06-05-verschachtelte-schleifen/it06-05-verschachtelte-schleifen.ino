/*
 * IT06.5 – Zwei Schleifen verschachteln
 *
 * Lernziel:
 * Eine innere Schleife für jeden Durchlauf einer äußeren Schleife ausführen,
 * um Zeilen und Spalten auszugeben.
 *
 * Bezug zu den Unterlagen:
 * IT06, Folien „Doppelschleife“ und „Verschachtelte Schleifen“;
 * IT03 Transferaufgabe „Spielfeld 3x3“.
 *
 * Beobachtung:
 * Ein Spielfeld mit 3 Zeilen und 3 Spalten, nummeriert von 1 bis 9.
 */

const byte ZEILEN = 3;
const byte SPALTEN = 3;

void setup() {
  Serial.begin(115200);

  for (byte zeile = 0; zeile < ZEILEN; zeile++) {
    for (byte spalte = 0; spalte < SPALTEN; spalte++) {
      byte feld = zeile * SPALTEN + spalte + 1;
      Serial.print("[");
      Serial.print(feld);
      Serial.print("]");
    }
    Serial.println();
  }
}

void loop() {
}

/*
 * Experimente:
 * 1. Erzeuge ein Spielfeld mit 4 Zeilen und 5 Spalten.
 * 2. Gib statt der Feldnummer die Zeile und die Spalte aus, z. B. [1,2].
 * 3. Verschiebe Serial.println(); in die innere Schleife.
 *
 * Lernfragen:
 * 1. Wie oft wird die innere Schleife insgesamt durchlaufen?
 * 2. Welche Schleife bestimmt die Anzahl der Zeilen?
 * 3. Wie entsteht aus zeile und spalte die Feldnummer?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen zwei Schleifen verschachteln und ihren Ablauf beschreiben können."
afterFocus: free
focus:
  - id: durchlaeufe
    title: "Durchläufe"
    objective: "Die Zahl der Durchläufe bestimmen und die Rolle beider Schleifen erklären."
    questions:
      - kind: prediction
        text: "Wie oft wird der Block der inneren Schleife insgesamt ausgeführt?"
      - kind: concept
        text: "Welche der beiden Schleifen bestimmt die Anzahl der Zeilen, die Schleife mit `zeile` oder die mit `spalte`?"
  - id: feldnummer
    title: "Feldnummer und Zeilenumbruch"
    objective: "Die Berechnung der Feldnummer und die Stellung des Zeilenumbruchs begründen."
    questions:
      - kind: concept
        text: "Wie entsteht `feld` aus `zeile` und `spalte`?"
      - kind: prediction
        text: "Wie sieht die Ausgabe aus, wenn `Serial.println()` in die innere Schleife verschoben wird?"
@end-unosim-tutor */
