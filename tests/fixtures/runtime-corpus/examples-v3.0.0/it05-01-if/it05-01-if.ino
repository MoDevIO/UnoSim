/*
 * IT05.1 – Eine Anweisung bedingt ausführen
 *
 * Lernziel:
 * Mit if einen Programmblock nur dann ausführen, wenn eine Bedingung wahr ist.
 *
 * Bezug zu den Unterlagen:
 * IT05, Folien „Einfache Verzweigung - if“ und „Einfache Verzweigung - Bedingung“
 * (unwahr ist nur 0).
 *
 * Beobachtung:
 * Der Messwert von A0 erscheint alle 500 ms. Liegt er über 600, steht
 * dahinter zusätzlich „Grenzwert ueberschritten“.
 */

const byte PIN_SENSOR = A0;
const unsigned int GRENZWERT = 600;

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned int messwert = analogRead(PIN_SENSOR);
  Serial.print(messwert);

  if (messwert > GRENZWERT) {
    Serial.print("  Grenzwert ueberschritten");
  }

  Serial.println();
  delay(500);
}

/*
 * Experimente:
 * 1. Stelle A0 im Simulator auf 599, 600 und 601.
 * 2. Ersetze > durch >= und wiederhole das erste Experiment.
 * 3. Zeichne zu loop() ein UML-Aktivitätsdiagramm mit der Verzweigung.
 *
 * Lernfragen:
 * 1. Welchen Wahrheitswert hat die Bedingung bei messwert = 700?
 * 2. Was geschieht, wenn die Bedingung falsch ist?
 * 3. Warum steht Serial.println() außerhalb des if-Blocks?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine einfache Verzweigung mit if formulieren und ihren Ablauf beschreiben können."
afterFocus: free
focus:
  - id: bedingung
    title: "Die Bedingung"
    objective: "Den Wahrheitswert der Bedingung bestimmen und das Verhalten bei falscher Bedingung beschreiben."
    questions:
      - kind: prediction
        text: "Welchen Wahrheitswert hat `messwert > GRENZWERT`, wenn A0 genau den Wert 600 liefert?"
      - kind: concept
        text: "Was geschieht mit dem Block nach `if`, wenn die Bedingung falsch ist?"
  - id: ablauf
    title: "Ablauf und Grenzfall"
    objective: "Den Ablauf in `loop` beschreiben und die Bedingung anpassen."
    questions:
      - kind: concept
        text: "Warum steht `Serial.println()` außerhalb des Blocks der Verzweigung?"
      - kind: transfer
        text: "Wie müsste die Bedingung lauten, damit die Meldung schon beim Wert 600 erscheint?"
@end-unosim-tutor */
