/*
 * IT07.7 – Ein Array an eine Funktion übergeben
 *
 * Lernziel:
 * Ein Array an Funktionen übergeben, die es füllen und auswerten, und
 * erklären, warum dabei das Original verändert wird.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Arrays und Funktionen“ (immer Call-by-reference, ohne &)
 * und Übung Datenlogger (Mittelwert über 5 Messwerte).
 *
 * Beobachtung:
 * Jede Sekunde werden 5 Messwerte von A0 erfasst, ausgegeben und gemittelt.
 */

const byte PIN_SENSOR = A0;
const byte ANZAHL = 5;

void messwerteErfassen(unsigned int messwerte[]) {
  for (byte i = 0; i < ANZAHL; i++) {
    messwerte[i] = analogRead(PIN_SENSOR);
    delay(100);
  }
}

float mittelwertBerechnen(unsigned int messwerte[]) {
  float summe = 0;
  for (byte i = 0; i < ANZAHL; i++) {
    summe += messwerte[i];
  }
  return summe / ANZAHL;
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned int messwerte[ANZAHL];

  messwerteErfassen(messwerte);

  for (byte i = 0; i < ANZAHL; i++) {
    Serial.print(messwerte[i]);
    Serial.print(" ");
  }
  Serial.print("-> Mittelwert: ");
  Serial.println(mittelwertBerechnen(messwerte), 1);

  delay(1000);
}

/*
 * Experimente:
 * 1. Verändere A0 im Simulator, während gemessen wird.
 * 2. Erhöhe ANZAHL auf 10.
 * 3. Schreibe eine Funktion maximumBestimmen(), die den größten Messwert
 *    zurückgibt.
 *
 * Lernfragen:
 * 1. Warum steht beim Aufruf messwerteErfassen(messwerte) kein &?
 * 2. Warum enthält messwerte nach dem Aufruf die gemessenen Werte?
 * 3. Warum wird summe als float deklariert?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Arrays an Funktionen übergeben und dort füllen und auswerten können."
  - "Sie sollen erklären können, warum Arrays immer als Referenz übergeben werden."
afterFocus: free
focus:
  - id: uebergabe
    title: "Übergabe eines Arrays"
    objective: "Erklären, warum die Funktion das Original-Array verändert."
    questions:
      - kind: concept
        text: "Warum enthält `messwerte` in `loop` nach dem Aufruf von `messwerteErfassen` die gemessenen Werte?"
      - kind: concept
        text: "Warum steht beim Aufruf `messwerteErfassen(messwerte)` kein Adressoperator?"
  - id: auswertung
    title: "Auswertung"
    objective: "Die Berechnung des Mittelwerts erklären und erweitern."
    questions:
      - kind: concept
        text: "Warum wird `summe` als `float` deklariert?"
      - kind: prediction
        text: "Welcher Mittelwert erscheint, wenn vier Messwerte 100 sind und einer 600 ist?"
      - kind: transfer
        text: "Wie würdest du eine Funktion schreiben, die den größten Wert aus `messwerte` zurückgibt?"
@end-unosim-tutor */
