// delay(587) measured with millis() (plan P1.8; the Uno gives 586–587 ms).
void setup() {
  Serial.begin(115200);
  unsigned long start = millis();
  delay(587);
  Serial.print("delay(587) = ");
  Serial.println(millis() - start);
}

void loop() {}
