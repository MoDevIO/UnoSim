// analogRead on the analog-only inputs A6 and A7 of the Nano, next to A0 and A5, against fixed
// voltages: ADC = floor(Vin * 1024 / Vref), at most 1023. A6 and A7 have no digital function:
// analogRead(6) and analogRead(7) name the channels as the core allows channel or pin numbers.
int read(uint8_t pin) {
  analogRead(pin);
  return analogRead(pin);
}

void setup() {
  Serial.begin(115200);
  Serial.print("A0 ");
  Serial.println(read(A0));
  Serial.print("A5 ");
  Serial.println(read(A5));
  Serial.print("A6 ");
  Serial.println(read(A6));
  Serial.print("A7 ");
  Serial.println(read(A7));
  Serial.print("analogRead(7) ");
  Serial.println(read(7));
  analogReference(INTERNAL);
  Serial.print("A7 internal ");
  Serial.println(read(A7));
  analogReference(DEFAULT);
  Serial.print("A6 pin number ");
  Serial.println(A6);
  Serial.print("A7 pin number ");
  Serial.println(A7);
  Serial.println("DONE");
}

void loop() {}
