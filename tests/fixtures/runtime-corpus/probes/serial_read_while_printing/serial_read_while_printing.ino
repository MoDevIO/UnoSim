// Serial input that arrives while the sketch is printing: every received
// character must be answered, none may get lost. The long answer keeps the
// transmitter busy while the next character arrives (87 us apart at 115200).
void setup() {
  Serial.begin(115200);
}

void loop() {
  if (Serial.available() > 0) {
    int code = Serial.read();
    Serial.print("got ");
    Serial.print(code);
    Serial.println(" while the transmitter is busy with a longer text");
  }
}
