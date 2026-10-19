/*
 * IT02.3 – Wahrheitswerte verknüpfen
 *
 * Lernziel:
 * Die Operatoren &&, || und ! auf Wahrheitswerte anwenden und mit
 * Beispielen aus der Steuerungstechnik verbinden.
 *
 * Bezug zu den Unterlagen:
 * IT02 Datenmanipulation, Folien „Wahrheitswerte“ und
 * „Wahrheitswerte und ihre Verknüpfung“ (Zweihandbedienung, Not-Aus).
 *
 * Beobachtung:
 * Der Antrieb bleibt aus (0), weil nur ein Taster gedrückt ist.
 * Die Antriebe werden gestoppt (1), weil ein Not-Aus-Taster gedrückt ist.
 */

bool tasterLinks = true;
bool tasterRechts = false;
bool notAus1 = false;
bool notAus2 = true;

void setup() {
  Serial.begin(115200);

  bool antriebEin = tasterLinks && tasterRechts;   // nur mit beiden Händen
  bool antriebeStoppen = notAus1 || notAus2;       // ein Not-Aus genügt
  bool signallampe = !tasterLinks;                 // Lampe aus, solange gedrückt

  Serial.print("Antrieb ein:       ");
  Serial.println(antriebEin);
  Serial.print("Antriebe stoppen:  ");
  Serial.println(antriebeStoppen);
  Serial.print("Signallampe:       ");
  Serial.println(signallampe);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze beide Taster auf true.
 * 2. Setze beide Not-Aus-Taster auf false.
 * 3. Setze tasterLinks = 456; statt true. Welcher Wahrheitswert entsteht?
 *
 * Lernfragen:
 * 1. Wann ergibt eine UND-Verknüpfung true?
 * 2. Wann ergibt eine ODER-Verknüpfung false?
 * 3. Welche Zahlenwerte gelten als FALSE, welche als TRUE?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen UND, ODER und NICHT auf Wahrheitswerte anwenden können."
  - "Sie sollen eine Steuerungsanforderung in eine boolesche Verknüpfung übersetzen können."
afterFocus: free
focus:
  - id: und-oder
    title: "UND und ODER"
    objective: "Die Ergebnisse von UND und ODER bestimmen und auf die Beispiele beziehen."
    questions:
      - kind: concept
        text: "Warum wird für `antriebEin` der Operator `&&` und nicht `||` verwendet?"
      - kind: prediction
        text: "Welchen Wert hat `antriebeStoppen`, wenn beide Not-Aus-Taster `false` sind?"
  - id: negation
    title: "Negation"
    objective: "Die Wirkung von `!` erklären und eine eigene Verknüpfung formulieren."
    questions:
      - kind: concept
        text: "Welche Wirkung hat der Operator `!` in der Zeile mit `signallampe`?"
      - kind: transfer
        text: "Wie würdest du ausdrücken, dass der Antrieb nur läuft, wenn beide Taster gedrückt sind und kein Not-Aus betätigt ist?"
@end-unosim-tutor */
