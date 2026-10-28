/*
 * IT07.3 – Einen Parameter als Wert übergeben (Call-by-value)
 *
 * Lernziel:
 * Beobachten, dass die Funktion mit einer Kopie arbeitet und eine Änderung
 * nur über den Rückgabewert nach außen gelangt.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Varianten der Parameterübergabe“ (Call-by-value, func1)
 * und „Übrigens: aNum += 100“.
 *
 * Beobachtung:
 * zaehler bleibt nach dem ersten Aufruf 0. Erst wenn der Rückgabewert
 * zugewiesen wird, steht in zaehler 100.
 */

int plusHundert(int zahl) {
  zahl += 100;        // dasselbe wie zahl = zahl + 100;
  return zahl;
}

void setup() {
  Serial.begin(115200);

  int zaehler = 0;
  Serial.print("Start:                     ");
  Serial.println(zaehler);

  plusHundert(zaehler);
  Serial.print("Rueckgabe nicht verwendet: ");
  Serial.println(zaehler);

  zaehler = plusHundert(zaehler);
  Serial.print("Rueckgabe zugewiesen:      ");
  Serial.println(zaehler);
}

void loop() {
}

/*
 * Experimente:
 * 1. Gib in plusHundert() den Wert von zahl vor dem return aus.
 * 2. Rufe zaehler = plusHundert(zaehler); zweimal hintereinander auf.
 * 3. Benenne den Parameter zahl in zaehler um. Ändert sich das Verhalten?
 *
 * Lernfragen:
 * 1. Welcher Wert wird beim Aufruf in den Parameter zahl kopiert?
 * 2. Warum bleibt zaehler nach dem ersten Aufruf 0?
 * 3. In welchem Bereich ist der Parameter zahl gültig?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen erklären können, dass bei Call-by-value eine Kopie übergeben wird."
afterFocus: free
focus:
  - id: kopie
    title: "Die Kopie"
    objective: "Erklären, was beim Aufruf kopiert wird und warum das Original unverändert bleibt."
    questions:
      - kind: concept
        text: "Welcher Wert wird beim Aufruf von `plusHundert` in den Parameter `zahl` kopiert?"
      - kind: concept
        text: "Warum bleibt `zaehler` nach dem ersten Aufruf von `plusHundert` unverändert?"
  - id: rueckgabe
    title: "Ergebnis nach außen geben"
    objective: "Den Weg des Ergebnisses über den Rückgabewert beschreiben."
    questions:
      - kind: prediction
        text: "Welchen Wert hat `zaehler`, wenn `zaehler = plusHundert(zaehler)` zweimal hintereinander ausgeführt wird?"
      - kind: concept
        text: "Ändert sich das Verhalten, wenn der Parameter `zahl` ebenfalls `zaehler` heißt, und warum?"
@end-unosim-tutor */
