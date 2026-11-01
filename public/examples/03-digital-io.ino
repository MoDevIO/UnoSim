/*
 * Eingang steuert Ausgang
 *
 * Lernziel:
 * Einen Eingangspegel direkt auf einen Ausgang übertragen.
 *
 * Beobachtung:
 * Setze Pin 2 im Simulator auf LOW: Die LED an Pin 13 leuchtet, solange er LOW bleibt.
 */

const byte PIN_TASTER = 2;
const byte PIN_LED = LED_BUILTIN;

void setup() {
  pinMode(PIN_TASTER, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  digitalWrite(PIN_LED, digitalRead(PIN_TASTER) == LOW ? HIGH : LOW);
}
