// analogRead on every analog input; A6/A7 exist on the Nano only.
void setup() {
  Serial.begin(115200);
  const uint8_t pins[] = {A0, A1, A2, A3, A4, A5, A6, A7};
  for (uint8_t i = 0; i < sizeof(pins); i++) {
    Serial.print("A");
    Serial.print(i);
    Serial.print(" = ");
    Serial.println(analogRead(pins[i]));
  }
  Serial.println("DONE");
}
void loop() {}
