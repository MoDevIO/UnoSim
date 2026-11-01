/*
 * LED blinken lassen
 *
 * Lernziel:
 * Einen Pin als Ausgang schalten und mit delay() einen festen Takt erzeugen.
 *
 * Beobachtung:
 * Die LED an Pin 13 wechselt alle 500 ms.
 */

const byte PIN_LED = LED_BUILTIN;

void setup() {
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  digitalWrite(PIN_LED, HIGH);
  delay(500);
  digitalWrite(PIN_LED, LOW);
  delay(500);
}
