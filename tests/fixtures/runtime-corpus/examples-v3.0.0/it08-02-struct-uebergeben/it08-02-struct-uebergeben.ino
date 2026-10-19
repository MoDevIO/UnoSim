/*
 * IT08.2 – Eine Struktur als Wert oder als Zeiger übergeben
 *
 * Lernziel:
 * Eine Struktur einmal als Kopie (Punkt) und einmal über ihre Adresse
 * (Pfeil ->) an eine Funktion übergeben und die Wirkung vergleichen.
 *
 * Bezug zu den Unterlagen:
 * IT08, Folie „struct – Zugriffsarten“ (Call by value: Punkt,
 * Call by reference: Elementverweisoperator ->); IT07 Parameterübergabe.
 *
 * Beobachtung:
 * Nach korrigierenKopie() ist der Messwert noch 20.0, nach
 * korrigierenOriginal() ist er 20.5.
 */

struct Messung {
  byte messstelle;
  float messwert;
};

void korrigierenKopie(struct Messung messung) {
  messung.messwert = messung.messwert + 0.5;
  Serial.print("  in korrigierenKopie:    ");
  Serial.println(messung.messwert, 1);
}

void korrigierenOriginal(struct Messung *messung) {
  messung->messwert = messung->messwert + 0.5;
  Serial.print("  in korrigierenOriginal: ");
  Serial.println(messung->messwert, 1);
}

void setup() {
  Serial.begin(115200);

  struct Messung messung = {1, 20.0};

  korrigierenKopie(messung);
  Serial.print("nach korrigierenKopie:    ");
  Serial.println(messung.messwert, 1);

  korrigierenOriginal(&messung);
  Serial.print("nach korrigierenOriginal: ");
  Serial.println(messung.messwert, 1);
}

void loop() {
}

/*
 * Experimente:
 * 1. Rufe korrigierenOriginal(&messung); zweimal auf.
 * 2. Schreibe in korrigierenOriginal() messung.messwert statt messung->messwert
 *    und lies die Fehlermeldung.
 * 3. Ändere korrigierenKopie() so, dass sie die korrigierte Struktur mit
 *    return zurückgibt, und weise das Ergebnis messung zu.
 *
 * Lernfragen:
 * 1. Warum ändert korrigierenKopie() den Messwert in setup() nicht?
 * 2. Wann wird der Punkt verwendet, wann der Pfeil ->?
 * 3. Warum wird beim Aufruf &messung geschrieben?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Struktur als Kopie und über einen Zeiger übergeben und die Wirkung vergleichen können."
  - "Sie sollen den Punktoperator und den Operator -> richtig einsetzen können."
afterFocus: free
focus:
  - id: kopie-oder-original
    title: "Kopie oder Original"
    objective: "Entscheiden, ob eine Funktion die Kopie oder das Original verändert."
    questions:
      - kind: concept
        text: "Warum ändert `korrigierenKopie` den Messwert in `setup` nicht?"
      - kind: prediction
        text: "Welcher Messwert steht in `setup`, wenn `korrigierenOriginal(&messung)` zweimal aufgerufen wird?"
  - id: punkt-und-pfeil
    title: "Punkt und Pfeil"
    objective: "Den Punktoperator und `->` je nach Übergabeart einsetzen."
    questions:
      - kind: concept
        text: "Wann wird in diesem Sketch der Punkt verwendet und wann `->`?"
      - kind: concept
        text: "Warum wird beim Aufruf `&messung` geschrieben?"
@end-unosim-tutor */
