// analogWrite on every PWM pin of the Uno. 0 and 255 are digital in the core
// (wiring_analog.c); the other values set OCR of the timer channel, which
// runs in an 8-bit PWM mode. Later a digitalWrite on a PWM pin ends the PWM.
void setup() {
  Serial.begin(115200);
  analogWrite(3, 0);
  analogWrite(5, 1);
  analogWrite(6, 25);
  analogWrite(9, 128);
  analogWrite(10, 254);
  analogWrite(11, 255);
  Serial.println("WRITTEN");
  delay(20);
  digitalWrite(9, LOW);
  analogWrite(10, 77);
  digitalWrite(10, HIGH);
  Serial.println("DONE");
}

void loop() {}
