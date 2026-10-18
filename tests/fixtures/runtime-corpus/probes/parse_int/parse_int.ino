// Stream::parseInt skips characters that are not part of a number, stops at
// the first character after the digits and gives up after the 1 s timeout.
void setup() {
  Serial.begin(115200);
}

void loop() {
  if (Serial.available()) {
    long n = Serial.parseInt();
    Serial.print("n=");
    Serial.println(n);
  }
}
