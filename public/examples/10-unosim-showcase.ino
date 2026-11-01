/*
 * UnoSim im Überblick
 *
 * Lernziel:
 * Digitale und analoge Ein- und Ausgänge mit serieller Ausgabe und Zeitsteuerung verbinden.
 *
 * Beobachtung:
 * Alle 500 ms erscheint der Zustand. Ändere A0 und Pin 2 im Simulator.
 */

const byte PIN_TASTER = 2;
const byte PIN_PWM = 9;
const byte PIN_LED = LED_BUILTIN;
unsigned long lastReport = 0;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TASTER, INPUT_PULLUP);
  pinMode(PIN_PWM, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  Serial.println("UnoSim showcase ready");
}

void loop() {
  int sensor = analogRead(A0);
  int brightness = map(sensor, 0, 1023, 0, 255);
  bool pressed = digitalRead(PIN_TASTER) == LOW;
  if (pressed) brightness = 255 - brightness;
  analogWrite(PIN_PWM, brightness);
  digitalWrite(PIN_LED, pressed ? HIGH : LOW);

  unsigned long now = millis();
  if (now - lastReport >= 500) {
    lastReport = now;
    Serial.print("A0=");
    Serial.print(sensor);
    Serial.print(" PWM=");
    Serial.print(brightness);
    Serial.print(" button=");
    Serial.println(pressed ? "pressed" : "released");
  }
}
