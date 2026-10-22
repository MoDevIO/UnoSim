// analogWrite on every PWM pin of the Mega: pins 2-13 (timers 0 to 4) and 44-46 (timer 5).
// 0 and 255 are digital in the core (wiring_analog.c), digitalWrite on a PWM pin ends the PWM.
void setup() {
  Serial.begin(115200);
  analogWrite(2, 20);
  analogWrite(3, 30);
  analogWrite(4, 40);
  analogWrite(5, 50);
  analogWrite(6, 60);
  analogWrite(7, 70);
  analogWrite(8, 80);
  analogWrite(9, 90);
  analogWrite(10, 100);
  analogWrite(11, 110);
  analogWrite(12, 120);
  analogWrite(13, 130);
  analogWrite(44, 144);
  analogWrite(45, 145);
  analogWrite(46, 146);
  Serial.println("WRITTEN");
  delay(20);
  digitalWrite(13, LOW);
  analogWrite(12, 0);
  analogWrite(11, 255);
  analogWrite(44, 1);
  Serial.println("DONE");
}

void loop() {}
