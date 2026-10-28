// millis() counts timer 0 overflows of 1.024 ms with a fractional correction;
// delay() waits on micros(), which has a resolution of 4 us. The elapsed
// times are taken before anything is printed.
void setup() {
  Serial.begin(115200);
  unsigned long start = millis();
  delay(100);
  unsigned long delayMs = millis() - start;
  start = micros();
  delayMicroseconds(1000);
  unsigned long delayUs = micros() - start;
  start = millis();
  for (int i = 0; i < 10; i++) {
    delay(50);
  }
  unsigned long loopMs = millis() - start;
  Serial.print("delay(100): ");
  Serial.println(delayMs);
  Serial.print("delayMicroseconds(1000): ");
  Serial.println(delayUs);
  Serial.print("10 x delay(50): ");
  Serial.println(loopMs);
  Serial.println("DONE");
}

void loop() {}
