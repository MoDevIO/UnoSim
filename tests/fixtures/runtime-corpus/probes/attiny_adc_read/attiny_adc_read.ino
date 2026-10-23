// ATtiny85 probe (plan P6.5): analogRead on A0-A3 (PB5, PB2, PB4, PB3) and by
// channel number, against VCC, 1.1 V and 2.56 V. The first conversion after a
// reference change is discarded as the datasheet recommends.
int read(uint8_t pin) {
  analogRead(pin);
  return analogRead(pin);
}

void setup() {
  Serial.begin(9600);
  Serial.print("A1 ");
  Serial.println(read(A1));
  Serial.print("A2 ");
  Serial.println(read(A2));
  Serial.print("A3 ");
  Serial.println(read(A3));
  Serial.print("channel 1 ");
  Serial.println(read(1));
  analogReference(INTERNAL1V1);
  Serial.print("internal 1.1 V: A3 ");
  Serial.println(read(A3));
  analogReference(INTERNAL2V56);
  Serial.print("internal 2.56 V: A3 ");
  Serial.println(read(A3));
  Serial.println("DONE");
}

void loop() {}
