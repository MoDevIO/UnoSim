// The host sends "ABC" while the sketch is still in delay(), before Serial.begin():
// the receiver is off, so the board loses the bytes. "XYZ" arrives after begin and is delivered.
void setup() {
  delay(800);
  Serial.begin(115200);
  delay(200);
  Serial.print("before begin: ");
  Serial.println(Serial.available());
  delay(400);
  Serial.print("after begin: ");
  Serial.println(Serial.available());
  while (Serial.available()) {
    Serial.print(Serial.read(), HEX);
    Serial.print(' ');
  }
  Serial.println();
  Serial.println("DONE");
}

void loop() {}
