// ATtiny85 probe (plan P6.5): analogWrite on the three PWM pins 0 (timer 0),
// 1 and 4 (timer 1), then 0 and 255 as digital levels and PWM back to digital.
void setup() {
  analogWrite(0, 40);
  analogWrite(1, 100);
  analogWrite(4, 200);
  delay(50);
  analogWrite(0, 0);
  analogWrite(1, 255);
  digitalWrite(4, LOW);
}

void loop() {}
