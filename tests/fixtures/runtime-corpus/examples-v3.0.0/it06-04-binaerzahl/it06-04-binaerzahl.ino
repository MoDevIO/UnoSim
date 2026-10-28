/*
 * IT06.4 – Eine Zahl binär ausgeben
 *
 * Lernziel:
 * Mit einer Zählschleife und den bitweisen Operatoren alle 8 Bits einer
 * Zahl ausgeben – auch die führenden Nullen.
 *
 * Bezug zu den Unterlagen:
 * IT06, Abschnitt „Beispiel 1: Anwendung von Schleifen bei dem Programm zur
 * Darstellung von Binärzahlen“; IT02 „Beispiel Dezimalzahl 37 als Binärzahl“.
 *
 * Beobachtung:
 * „37 = 00100101“. Zum Vergleich gibt BIN die Zahl ohne führende Nullen aus.
 */

byte a = 37;

void setup() {
  Serial.begin(115200);

  Serial.print(a);
  Serial.print(" = ");
  for (int i = 7; i >= 0; i--) {
    Serial.print(a & (1 << i) && 1);   // ist Bit i gesetzt?
  }
  Serial.println();

  Serial.print("Mit BIN: ");
  Serial.println(a, BIN);
}

void loop() {
}

/*
 * Experimente:
 * 1. Gib die Zahlen 200 und 255 aus.
 * 2. Ergänze nach dem vierten Bit ein Leerzeichen (wie auf der Folie).
 * 3. Erweitere das Programm auf 16 Bit: unsigned int a = 32109; und i ab 15.
 *
 * Lernfragen:
 * 1. Welche Zahl ergibt 1 << i für i = 7?
 * 2. Warum zählt die Schleife von 7 herunter und nicht von 0 hoch?
 * 3. Welchen Vorteil hat die Schleife gegenüber acht einzelnen Ausgaben?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Zählschleife mit bitweisen Operatoren kombinieren können."
  - "Sie sollen den Vorteil einer Schleife für die Skalierbarkeit eines Programms erklären können."
afterFocus: free
focus:
  - id: bit-pruefen
    title: "Ein Bit prüfen"
    objective: "Erklären, wie in jedem Durchlauf ein Bit geprüft wird."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat `1 << i` in der Schleife?"
      - kind: prediction
        text: "Was wird im ersten Durchlauf ausgegeben, wenn `a` den Wert 200 hat?"
  - id: schleife-und-skalierung
    title: "Schleife und Skalierbarkeit"
    objective: "Die Zählrichtung begründen und das Programm auf 16 Bit übertragen."
    questions:
      - kind: concept
        text: "Warum zählt die Schleife mit `i--` von 7 herunter?"
      - kind: transfer
        text: "Was musst du ändern, damit alle 16 Bits einer größeren Zahl ausgegeben werden?"
@end-unosim-tutor */
