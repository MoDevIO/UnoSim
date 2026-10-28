/*
 * IT07.4 – Die Adresse einer Variablen übergeben (Call-by-reference)
 *
 * Lernziel:
 * Eine Variable über ihre Adresse (Zeiger) in einer Funktion verändern.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Varianten der Parameterübergabe“ (Call-by-reference, func2):
 * * im Parameter, * beim Schreiben, & beim Aufruf.
 *
 * Beobachtung:
 * Nach dem Aufruf steht in zaehler 50. Die Änderung bleibt erhalten.
 */

void plusFuenfzig(int *zahl) {
  *zahl += 50;        // den Wert an der Adresse ändern, nicht die Adresse
}

void setup() {
  Serial.begin(115200);

  int zaehler = 0;
  Serial.print("Vor dem Aufruf:  ");
  Serial.println(zaehler);

  plusFuenfzig(&zaehler);
  Serial.print("Nach dem Aufruf: ");
  Serial.println(zaehler);
}

void loop() {
}

/*
 * Experimente:
 * 1. Rufe plusFuenfzig(&zaehler); dreimal auf.
 * 2. Entferne beim Aufruf das & und lies die Fehlermeldung.
 * 3. Entferne in der Funktion das * vor zahl und lies die Fehlermeldung.
 *
 * Lernfragen:
 * 1. Welche Bedeutung hat & beim Funktionsaufruf?
 * 2. Welche Bedeutung hat * in der Parameterliste, welche in *zahl += 50?
 * 3. Warum bleibt die Änderung nach dem Funktionsaufruf erhalten?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Variable über einen Zeiger in einer Funktion verändern können."
  - "Sie sollen Call-by-value und Call-by-reference unterscheiden können."
afterFocus: free
focus:
  - id: adresse-und-zeiger
    title: "Adresse und Zeiger"
    objective: "Die Bedeutung von `&` beim Aufruf und `*` in der Funktion erklären."
    questions:
      - kind: concept
        text: "Welche Bedeutung hat `&` beim Aufruf `plusFuenfzig(&zaehler)`?"
      - kind: concept
        text: "Welche Bedeutung hat `*` in `*zahl += 50`?"
  - id: wirkung
    title: "Wirkung auf das Original"
    objective: "Begründen, warum die Änderung erhalten bleibt, und mit Call-by-value vergleichen."
    questions:
      - kind: concept
        text: "Warum hat `zaehler` nach dem Aufruf von `plusFuenfzig` einen anderen Wert?"
      - kind: prediction
        text: "Welchen Wert hat `zaehler`, wenn `plusFuenfzig(&zaehler)` dreimal aufgerufen wird?"
@end-unosim-tutor */
