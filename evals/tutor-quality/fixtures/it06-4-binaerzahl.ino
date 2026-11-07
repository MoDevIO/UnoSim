byte a = 37;

void setup() {
  Serial.begin(115200);

  Serial.print(a);
  Serial.print(" = ");
  for (int i = 7; i >= 0; i--) {
    Serial.print(a & (1 << i) && 1);   // ist Bit i gesetzt?
  }
  Serial.println();

  Serial.print("Mit BIN: ");
  Serial.println(a, BIN);
}

void loop() {
}
