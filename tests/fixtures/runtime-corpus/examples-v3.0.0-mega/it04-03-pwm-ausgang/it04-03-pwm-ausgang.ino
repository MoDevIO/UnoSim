/*
 * IT04.3 – Einen Ausgang mit PWM ansteuern
 *
 * Lernziel:
 * Mit analogWrite() an einem PWM-fähigen Pin eine veränderliche mittlere
 * Spannung erzeugen.
 *
 * Bezug zu den Unterlagen:
 * IT04, Folien „Analogen Arduino-Ausgang schreiben mit analogWrite“,
 * „Info zur Puls-Weiten-Modulation“ und „analogWrite - Beispiel“
 * (aus, ca. 10 %, 100 %).
 *
 * Beobachtung:
 * Pin 11 ist nacheinander je 1 s aus (0), zu etwa 10 % (25) und
 * voll (255) eingeschaltet.
 */

const byte PIN_PWM = 11;

void setup() {
  pinMode(PIN_PWM, OUTPUT);
}

void loop() {
  analogWrite(PIN_PWM, 0);
  delay(1000);
  analogWrite(PIN_PWM, 25);
  delay(1000);
  analogWrite(PIN_PWM, 255);
  delay(1000);
}

/*
 * Experimente:
 * 1. Ergänze den Wert 128. Welche mittlere Spannung entsteht?
 * 2. Erzeuge an Pin 6 eine mittlere Spannung von 3,3 V. Welchen Wert brauchst du?
 * 3. Lasse den Wert in kleinen Schritten von 0 bis 255 steigen.
 *
 * Lernfragen:
 * 1. Welchen Wertebereich erwartet analogWrite()?
 * 2. Welche Pins des Arduino Uno sind PWM-fähig?
 * 3. Warum ändert PWM die mittlere Spannung, obwohl der Pin nur 0 V oder 5 V kennt?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen mit analogWrite() eine mittlere Ausgangsspannung einstellen können."
afterFocus: free
focus:
  - id: wertebereich
    title: "Wertebereich und Tastgrad"
    objective: "Den Wertebereich von `analogWrite` nennen und Werte einem Tastgrad zuordnen."
    questions:
      - kind: recall
        text: "Welchen Wertebereich erwartet `analogWrite`?"
      - kind: concept
        text: "Warum entspricht der Wert 25 ungefähr einem Tastgrad von 10 %?"
      - kind: application
        text: "Welchen Wert brauchst du, um an einem PWM-Pin eine mittlere Spannung von 3,3 V zu erzeugen?"
  - id: pwm-prinzip
    title: "Prinzip der PWM"
    objective: "Erklären, wie PWM eine mittlere Spannung erzeugt, und geeignete Pins nennen."
    questions:
      - kind: concept
        text: "Warum ändert sich die mittlere Spannung an `PIN_PWM`, obwohl der Pin nur ein- oder ausgeschaltet ist?"
      - kind: recall
        text: "Welche Pins des Arduino Uno können mit `analogWrite` ein PWM-Signal ausgeben?"
@end-unosim-tutor */
