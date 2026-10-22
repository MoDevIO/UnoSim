/*
 * IT03.6 – Einen digitalen Eingang lesen
 *
 * Lernziel:
 * Einen Eingang mit internem Pullup-Widerstand konfigurieren und seinen
 * Zustand mit digitalRead() lesen.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Arduino-Pin einrichten mit pinMode“ und
 * „Digitalen Arduino-Eingang lesen mit digitalRead“.
 *
 * Beobachtung:
 * Der serielle Monitor zeigt alle 500 ms den Zustand von Pin 2:
 * 1 bei offenem Eingang, 0 wenn der Eingang im Simulator auf LOW gesetzt wird.
 */

const byte PIN_TASTER = 2;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TASTER, INPUT_PULLUP);
}

void loop() {
  byte zustand = digitalRead(PIN_TASTER);
  Serial.println(zustand);
  delay(500);
}

/*
 * Experimente:
 * 1. Schalte Pin 2 im Simulator zwischen HIGH und LOW um.
 * 2. Ersetze INPUT_PULLUP durch INPUT. Welcher Zustand ist jetzt bei
 *    offenem Eingang zu erwarten?
 * 3. Verkürze die Wartezeit auf 50 ms.
 *
 * Lernfragen:
 * 1. Welche Werte kann digitalRead() liefern?
 * 2. Warum liefert ein gedrückter Taster bei INPUT_PULLUP den Wert LOW?
 * 3. Welchen Zweck hat ein Pullup-Widerstand?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen digitalen Eingang mit internem Pullup-Widerstand lesen können."
afterFocus: free
focus:
  - id: eingang-lesen
    title: "Eingang lesen"
    objective: "Die möglichen Werte von `digitalRead` nennen und deuten."
    questions:
      - kind: recall
        text: "Welche Werte kann `digitalRead` liefern?"
      - kind: concept
        text: "Warum genügt für `zustand` der Datentyp `byte`?"
  - id: pullup
    title: "Pullup-Widerstand"
    objective: "Den Zweck von `INPUT_PULLUP` erklären und die Tasterlogik vorhersagen."
    questions:
      - kind: concept
        text: "Welchen Zweck hat `INPUT_PULLUP` für den Pin `PIN_TASTER`?"
      - kind: prediction
        text: "Welcher Wert wird ausgegeben, solange ein Taster an `PIN_TASTER` gedrückt ist, und warum?"
@end-unosim-tutor */
