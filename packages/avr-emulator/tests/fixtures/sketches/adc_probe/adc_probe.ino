// ADC probe (plan P1.6): A0 and A5 with DEFAULT, INTERNAL (1.1 V) and
// EXTERNAL (AREF) every 5 ms. The first read after a reference change is
// discarded, as the datasheet recommends.
int readWith(uint8_t reference, uint8_t pin) {
  analogReference(reference);
  analogRead(pin);
  return analogRead(pin);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.print("A0 ");
  Serial.print(readWith(DEFAULT, A0));
  Serial.print(" ");
  Serial.print(readWith(INTERNAL, A0));
  Serial.print(" ");
  Serial.print(readWith(EXTERNAL, A0));
  Serial.print(" A5 ");
  Serial.println(readWith(DEFAULT, A5));
  delay(5);
}
