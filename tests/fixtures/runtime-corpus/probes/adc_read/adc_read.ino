// analogRead against fixed voltages: ADC = floor(Vin * 1024 / Vref), at most
// 1023. The first conversion after a reference change is discarded as the
// datasheet recommends.
int read(uint8_t pin) {
  analogRead(pin);
  return analogRead(pin);
}

void setup() {
  Serial.begin(115200);
  Serial.print("A0 ");
  Serial.println(read(A0));
  Serial.print("A1 ");
  Serial.println(read(A1));
  Serial.print("A2 ");
  Serial.println(read(A2));
  Serial.print("A3 ");
  Serial.println(read(A3));
  Serial.print("A4 ");
  Serial.println(read(A4));
  analogReference(INTERNAL);
  Serial.print("A4 internal ");
  Serial.println(read(A4));
  analogReference(DEFAULT);
  Serial.print("A4 default again ");
  Serial.println(read(A4));
  Serial.println("DONE");
}

void loop() {}
