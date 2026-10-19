/*
 * IT02.2 – Zwei Werte vergleichen
 *
 * Lernziel:
 * Vergleichsoperatoren anwenden, ihr Ergebnis als Wahrheitswert deuten und
 * den Vergleich == von der Zuweisung = unterscheiden.
 *
 * Bezug zu den Unterlagen:
 * IT02 Datenmanipulation, Folien „Vergleichsoperatoren“ und
 * „Zuweisungs- und Vergleichsoperator“ (sehr häufige Fehlerursache).
 *
 * Beobachtung:
 * Ein wahrer Vergleich erscheint als 1, ein falscher als 0.
 */

int a = 7;
int b = 10;

void setup() {
  Serial.begin(115200);

  Serial.print("a == b: ");
  Serial.println(a == b);
  Serial.print("a != b: ");
  Serial.println(a != b);
  Serial.print("a < b:  ");
  Serial.println(a < b);
  Serial.print("a >= b: ");
  Serial.println(a >= b);

  bool gleich = (a == b);
  Serial.print("gleich: ");
  Serial.println(gleich);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze a ebenfalls auf 10. Welche Ergebnisse ändern sich?
 * 2. Ersetze in der Zeile mit gleich das == durch = und gib danach auch a aus.
 *    Was ist mit a passiert?
 * 3. Ergänze die Vergleiche a > b und a <= b.
 *
 * Lernfragen:
 * 1. Welche Vergleiche sind bei a = 7 und b = 10 wahr?
 * 2. Was ist der Unterschied zwischen = und ==?
 * 3. Welche zwei Werte kann das Ergebnis eines Vergleichs annehmen?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Vergleichsoperatoren anwenden und ihr Ergebnis deuten können."
  - "Sie sollen Zuweisung und Vergleich sicher unterscheiden können."
afterFocus: free
focus:
  - id: vergleichsergebnis
    title: "Ergebnis eines Vergleichs"
    objective: "Das Ergebnis mehrerer Vergleiche bestimmen und die Darstellung als 1 oder 0 erklären."
    questions:
      - kind: prediction
        text: "Welche der Vergleiche `a == b`, `a != b`, `a < b` und `a >= b` sind mit den aktuellen Werten wahr?"
      - kind: recall
        text: "Wie werden ein wahres und ein falsches Ergebnis in der Ausgabe dargestellt?"
  - id: zuweisung-oder-vergleich
    title: "Zuweisung oder Vergleich"
    objective: "Den Unterschied zwischen `=` und `==` erklären und die Folge einer Verwechslung vorhersagen."
    questions:
      - kind: concept
        text: "Was ist der Unterschied zwischen `=` und `==`?"
      - kind: prediction
        text: "Welchen Wert hat `a` danach, wenn in der Zeile mit `gleich` versehentlich nur ein Gleichheitszeichen steht?"
      - kind: transfer
        text: "Wie kannst du beim Programmieren verhindern, dass du `=` und `==` verwechselst?"
@end-unosim-tutor */
