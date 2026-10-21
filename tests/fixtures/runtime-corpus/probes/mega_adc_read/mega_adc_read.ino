// analogRead on the analog inputs of the Mega 2560, among them A8-A15 which need
// MUX5, against fixed voltages: ADC = floor(Vin * 1024 / Vref), at most 1023.
// The first conversion after a reference change is discarded as the datasheet
// recommends.
int read(uint8_t pin) {
  analogRead(pin);
  return analogRead(pin);
}

void setup() {
  Serial.begin(115200);
  Serial.print("A0 ");
  Serial.println(read(A0));
  Serial.print("A7 ");
  Serial.println(read(A7));
  Serial.print("A8 ");
  Serial.println(read(A8));
  Serial.print("A15 ");
  Serial.println(read(A15));
  analogReference(INTERNAL1V1);
  Serial.print("A15 internal 1.1 V ");
  Serial.println(read(A15));
  analogReference(INTERNAL2V56);
  Serial.print("A15 internal 2.56 V ");
  Serial.println(read(A15));
  analogReference(DEFAULT);
  Serial.print("A15 default again ");
  Serial.println(read(A15));
  Serial.print("analogRead(15) = ");
  Serial.println(read(15));
  Serial.println("DONE");
}

void loop() {}
