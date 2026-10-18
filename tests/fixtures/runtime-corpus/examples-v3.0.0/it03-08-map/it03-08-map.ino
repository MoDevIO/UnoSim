/*
 * IT03.8 – Werte mit map() umrechnen
 *
 * Lernziel:
 * Mit map() einen Wert aus einem Wertebereich in einen anderen übertragen
 * (Dreisatz) und die Ganzzahlmathematik von map() beachten.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Dreisatz mit map()“ und „Zahl mappen“.
 *
 * Beobachtung:
 * 23 im Bereich 0 bis 100 liegt dort, wo 230 im Bereich 0 bis 1000 liegt.
 * Mit vertauschtem Zielbereich ergibt sich 770. Für 1 von 0 bis 3 auf
 * 0 bis 10 erscheint 3 statt 3,33.
 */

const int A_VON = 0;
const int A_BIS = 100;
const int B_VON = 0;
const int B_BIS = 1000;

void setup() {
  Serial.begin(115200);

  long gemappt = map(23, A_VON, A_BIS, B_VON, B_BIS);
  Serial.println(gemappt);

  gemappt = map(23, A_VON, A_BIS, B_BIS, B_VON);
  Serial.println(gemappt);

  long abgeschnitten = map(1, 0, 3, 0, 10);
  Serial.println(abgeschnitten);
}

void loop() {
}

/*
 * Experimente:
 * 1. Bilde 50 und 100 ab.
 * 2. Bilde den Wert 150 ab. Begrenzt map() das Ergebnis auf den Zielbereich?
 * 3. Rechne einen Messwert von 0 bis 1023 in einen PWM-Wert von 0 bis 255 um.
 *
 * Lernfragen:
 * 1. Welche Bedeutung haben die vier Bereichsgrenzen?
 * 2. Was bewirkt das Vertauschen der Grenzen im Zielbereich?
 * 3. Warum liefert map() keine Nachkommastellen?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen map() zur Umrechnung zwischen Wertebereichen anwenden können."
  - "Sie sollen erklären können, dass map() mit ganzen Zahlen rechnet."
afterFocus: free
focus:
  - id: bereichsgrenzen
    title: "Bereichsgrenzen"
    objective: "Die vier Bereichsgrenzen deuten und das Vertauschen erklären."
    questions:
      - kind: concept
        text: "Welche Bedeutung haben `A_VON`, `A_BIS`, `B_VON` und `B_BIS` im Aufruf von `map`?"
      - kind: concept
        text: "Warum ergibt sich 770, wenn `B_BIS` und `B_VON` im Aufruf vertauscht werden?"
  - id: ganzzahlen
    title: "Ganzzahlmathematik"
    objective: "Erklären, warum Nachkommastellen fehlen, und das Verhalten außerhalb des Bereichs vorhersagen."
    questions:
      - kind: concept
        text: "Warum liefert `abgeschnitten` den Wert 3 und nicht 3,33?"
      - kind: prediction
        text: "Welches Ergebnis liefert `map` für den Wert 150, wenn der Ausgangsbereich von 0 bis 100 reicht?"
      - kind: transfer
        text: "Wie würdest du einen Messwert von 0 bis 1023 mit `map` in einen Wert von 0 bis 255 umrechnen?"
@end-unosim-tutor */
