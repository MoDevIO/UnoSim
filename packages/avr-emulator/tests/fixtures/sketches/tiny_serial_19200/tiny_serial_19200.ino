// ATtiny85 serial probe (plan P6.3): baud rate detection at 19200.
void setup() {
  Serial.begin(19200);
  Serial.println("fast 19200");
  Serial.println("DONE");
}

void loop() {}
