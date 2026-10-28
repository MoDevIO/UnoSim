/*
 * IT05.3 – Mehrere Bedingungen nacheinander prüfen
 *
 * Lernziel:
 * Mit if / else if / else eine Mehrfachverzweigung formulieren und die
 * Reihenfolge der Bedingungen begründen.
 *
 * Bezug zu den Unterlagen:
 * IT05, Folien „Mehrfach Verzweigung – if/else if/else“ (Syntax und Beispiel).
 *
 * Beobachtung:
 * Je nach Wert an A0 erscheint „dunkel“ (unter 300), „mittel“ (unter 700)
 * oder „hell“.
 */

const byte PIN_SENSOR = A0;
const unsigned int GRENZE_DUNKEL = 300;
const unsigned int GRENZE_MITTEL = 700;

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned int messwert = analogRead(PIN_SENSOR);
  Serial.print(messwert);

  if (messwert < GRENZE_DUNKEL) {
    Serial.println("  dunkel");
  } else if (messwert < GRENZE_MITTEL) {
    Serial.println("  mittel");
  } else {
    Serial.println("  hell");
  }

  delay(500);
}

/*
 * Experimente:
 * 1. Stelle A0 auf 100, 500 und 900.
 * 2. Vertausche die ersten beiden Bedingungen (zuerst GRENZE_MITTEL prüfen).
 *    Erscheint „dunkel“ noch?
 * 3. Ergänze eine vierte Stufe „sehr hell“ ab 950.
 *
 * Lernfragen:
 * 1. Warum wird die zweite Bedingung nur geprüft, wenn die erste falsch ist?
 * 2. Warum braucht die zweite Bedingung keinen Vergleich mit GRENZE_DUNKEL?
 * 3. Wann wird der letzte else-Zweig ausgeführt?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Mehrfachverzweigung mit else if formulieren und die Reihenfolge der Bedingungen begründen können."
afterFocus: free
focus:
  - id: pruefreihenfolge
    title: "Prüfreihenfolge"
    objective: "Erklären, in welcher Reihenfolge die Bedingungen geprüft werden."
    questions:
      - kind: concept
        text: "Warum wird `messwert < GRENZE_MITTEL` nur geprüft, wenn `messwert < GRENZE_DUNKEL` falsch ist?"
      - kind: prediction
        text: "Welche Ausgabe erscheint für den Messwert 300?"
  - id: reihenfolge-aendern
    title: "Reihenfolge ändern"
    objective: "Die Folge einer vertauschten Reihenfolge vorhersagen und eine Stufe ergänzen."
    questions:
      - kind: prediction
        text: "Erscheint „dunkel“ noch, wenn zuerst `GRENZE_MITTEL` und erst danach `GRENZE_DUNKEL` geprüft wird?"
      - kind: transfer
        text: "Wie würdest du eine vierte Stufe für sehr helles Licht ergänzen?"
@end-unosim-tutor */
