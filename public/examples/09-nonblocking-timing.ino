/*
 * Zeitsteuerung ohne delay()
 *
 * Lernziel:
 * Mit millis() eine Aktion takten, ohne loop() anzuhalten.
 *
 * Beobachtung:
 * Die LED an Pin 13 wechselt alle 500 ms, im Monitor erscheinen abwechselnd "tick" und "tock".
 */

const byte PIN_LED = LED_BUILTIN;
unsigned long lastChange = 0;
byte ledState = LOW;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  unsigned long now = millis();
  if (now - lastChange >= 500) {
    lastChange = now;
    ledState = ledState == LOW ? HIGH : LOW;
    digitalWrite(PIN_LED, ledState);
    Serial.println(ledState == HIGH ? "tick" : "tock");
  }
}
