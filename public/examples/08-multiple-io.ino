/*
 * Mehrere Ein- und Ausgänge
 *
 * Lernziel:
 * Analogen und digitalen Eingang auf einen PWM-Ausgang abbilden.
 *
 * Beobachtung:
 * A0 bestimmt den PWM-Wert an Pin 9; Pin 2 auf LOW kehrt ihn um. Der Monitor zeigt beide Werte.
 */

const byte PIN_TASTER = 2;
const byte PIN_PWM = 9;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TASTER, INPUT_PULLUP);
  pinMode(PIN_PWM, OUTPUT);
}

void loop() {
  int sensor = analogRead(A0);
  int brightness = map(sensor, 0, 1023, 0, 255);
  if (digitalRead(PIN_TASTER) == LOW) brightness = 255 - brightness;
  analogWrite(PIN_PWM, brightness);
  Serial.print("sensor=");
  Serial.print(sensor);
  Serial.print(" pwm=");
  Serial.println(brightness);
  delay(250);
}
