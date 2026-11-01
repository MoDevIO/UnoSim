/*
 * Digitalen Eingang lesen
 *
 * Lernziel:
 * Einen Eingang mit internem Pull-up lesen.
 *
 * Beobachtung:
 * Der Monitor zeigt alle 500 ms "released". Setze Pin 2 im Simulator auf LOW: Es erscheint "pressed".
 */

const byte PIN_TASTER = 2;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TASTER, INPUT_PULLUP);
}

void loop() {
  Serial.println(digitalRead(PIN_TASTER) == LOW ? "pressed" : "released");
  delay(500);
}
