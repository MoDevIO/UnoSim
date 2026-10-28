// Receive-buffer probe (plan P1.7): the sketch reads nothing for 300 ms, then
// counts what the core's ring buffer kept.
void setup() {
  Serial.begin(115200);
  delay(300);
  int count = 0;
  while (Serial.available()) {
    Serial.read();
    count++;
  }
  Serial.print("kept ");
  Serial.println(count);
}

void loop() {}
