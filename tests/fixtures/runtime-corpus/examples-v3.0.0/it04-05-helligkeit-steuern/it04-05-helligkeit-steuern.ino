/*
 * IT04.5 – Mit einem Sensorwert die Helligkeit steuern
 *
 * Lernziel:
 * Einen analogen Messwert mit map() in einen PWM-Wert umrechnen und damit
 * eine LED heller oder dunkler schalten.
 *
 * Bezug zu den Unterlagen:
 * IT04, Folien „Bauteilewissen: Lichtsensor (LDR)“ und Transferaufgabe
 * „LDR lesen und LED heller bzw. dunkler schalten“; IT03 „Dreisatz mit map()“.
 *
 * Beobachtung:
 * Je höher der Wert an A0 im Simulator, desto größer der PWM-Wert an Pin 9:
 * 0 ergibt 0, 1023 ergibt 255.
 */

const byte PIN_LDR = A0;
const byte PIN_LED = 9;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  unsigned int licht = analogRead(PIN_LDR);
  long helligkeit = map(licht, 0, 1023, 0, 255);
  analogWrite(PIN_LED, helligkeit);

  Serial.print("Licht: ");
  Serial.print(licht);
  Serial.print(" -> PWM: ");
  Serial.println(helligkeit);
  delay(200);
}

/*
 * Experimente:
 * 1. Vertausche im Zielbereich 0 und 255. Wie verhält sich die LED jetzt?
 * 2. Ersetze map() durch die Rechnung licht / 4. Vergleiche die Ergebnisse.
 * 3. Begrenze die Helligkeit auf höchstens 128.
 *
 * Lernfragen:
 * 1. Warum ist eine Umrechnung zwischen analogRead() und analogWrite() nötig?
 * 2. Welche Wirkkette verbindet Lichtänderung und LED-Helligkeit?
 * 3. Warum ergibt licht / 4 fast dasselbe wie map()?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen Messwert in einen Stellwert umrechnen und ausgeben können."
afterFocus: free
focus:
  - id: wertebereiche
    title: "Zwei Wertebereiche"
    objective: "Begründen, warum zwischen Eingangs- und Ausgangswert umgerechnet werden muss."
    questions:
      - kind: concept
        text: "Warum kann `licht` nicht direkt an `analogWrite` übergeben werden?"
      - kind: prediction
        text: "Welchen Wert erhält `helligkeit`, wenn `licht` den Wert 512 hat?"
  - id: wirkkette
    title: "Wirkkette"
    objective: "Die Wirkkette vom Sensor bis zur LED beschreiben und verändern."
    questions:
      - kind: application
        text: "Welche Schritte liegen zwischen einer Lichtänderung am Sensor und einer Helligkeitsänderung an `PIN_LED`?"
      - kind: transfer
        text: "Wie würdest du das Programm ändern, damit die LED bei viel Licht dunkler wird?"
@end-unosim-tutor */
