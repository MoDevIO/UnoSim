// The host sends "ABC" while the sketch is still in delay(), before Serial.begin().
// Does the receiver keep those bytes (emulator: held until the receiver is enabled) or lose them?
void setup() {
  delay(5000);
  Serial.begin(115200);
  delay(200);
  Serial.print("available: ");
  Serial.println(Serial.available());
  while (Serial.available()) {
    Serial.print(Serial.read(), HEX);
    Serial.print(' ');
  }
  Serial.println();
  Serial.println("DONE");
}

void loop() {}
