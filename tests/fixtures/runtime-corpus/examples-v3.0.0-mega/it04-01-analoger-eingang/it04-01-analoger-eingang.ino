/*
 * IT04.1 – Einen analogen Eingang lesen
 *
 * Lernziel:
 * Mit analogRead() eine Spannung am Pin A0 als 10-Bit-Wert erfassen.
 *
 * Bezug zu den Unterlagen:
 * IT04, Folien „Was sind analoge Eingänge?“ und
 * „Analogen Arduino-Eingang lesen mit analogRead“.
 *
 * Beobachtung:
 * Der serielle Monitor zeigt alle 250 ms „A0=“ und einen Wert von 0 bis 1023.
 * Stelle im Simulator verschiedene Werte für A0 ein.
 */

const byte PIN_SENSOR = A0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned int messwert = analogRead(PIN_SENSOR);
  Serial.print("A0=");
  Serial.println(messwert);
  delay(250);
}

/*
 * Experimente:
 * 1. Stelle A0 im Simulator auf 0, auf den Mittelwert und auf 1023.
 * 2. Lies statt A0 den Eingang A1.
 * 3. Am realen Board: Verbinde A0 mit 5V und danach mit GND.
 *
 * Lernfragen:
 * 1. Welchen Wertebereich liefert analogRead() beim Arduino Uno?
 * 2. Warum sind für diesen Bereich 10 Bit erforderlich?
 * 3. Warum wurde für messwert unsigned int gewählt?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen analogen Messwert einlesen und seinen Wertebereich erklären können."
afterFocus: free
focus:
  - id: wertebereich
    title: "Wertebereich"
    objective: "Den Wertebereich von `analogRead` nennen und aus der Auflösung begründen."
    questions:
      - kind: recall
        text: "Welchen Wertebereich liefert `analogRead` beim Arduino Uno?"
      - kind: concept
        text: "Warum sind für diesen Wertebereich 10 Bit erforderlich?"
  - id: messwert
    title: "Messwert und Datentyp"
    objective: "Den Datentyp begründen und einen Messwert abschätzen."
    questions:
      - kind: concept
        text: "Warum ist `unsigned int` für `messwert` geeignet?"
      - kind: application
        text: "Welchen Wert erwartest du für `messwert`, wenn an `PIN_SENSOR` ungefähr 2,5 V anliegen?"
@end-unosim-tutor */
