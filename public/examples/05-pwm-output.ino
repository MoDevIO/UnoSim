/*
 * LED dimmen mit PWM
 *
 * Lernziel:
 * Mit analogWrite() die mittlere Spannung an einem PWM-Pin ändern.
 *
 * Beobachtung:
 * Der PWM-Wert an Pin 9 steigt von 0 bis 255 und fällt wieder.
 */

const byte PIN_LED = 9;

void setup() {
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  for (int brightness = 0; brightness <= 255; brightness += 5) {
    analogWrite(PIN_LED, brightness);
    delay(20);
  }
  for (int brightness = 255; brightness >= 0; brightness -= 5) {
    analogWrite(PIN_LED, brightness);
    delay(20);
  }
}
