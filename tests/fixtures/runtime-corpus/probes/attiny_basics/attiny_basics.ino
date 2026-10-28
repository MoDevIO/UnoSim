// ATtiny85 probe (plan P6.5): types, arithmetic, Serial.print, time and the
// memory layout of ATTinyCore 1.5.2 at 8 MHz; Serial is TinySoftwareSerial on PB0.
void setup() {
  Serial.begin(9600);
  Serial.print("sizeof int long float double: ");
  Serial.print(sizeof(int));
  Serial.print(" ");
  Serial.print(sizeof(long));
  Serial.print(" ");
  Serial.print(sizeof(float));
  Serial.print(" ");
  Serial.println(sizeof(double));
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  Serial.print("7 / 2 = ");
  Serial.println(7 / 2);
  Serial.print("print(2.5) = ");
  Serial.println(2.5);
  Serial.print("Umlaut: ");
  Serial.println("\xC3\xA4\xC3\xB6\xC3\xBC");
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.print("E2END = ");
  Serial.println(E2END);
  Serial.print("FLASHEND = 0x");
  Serial.println(FLASHEND, HEX);
  unsigned long t0 = millis();
  delay(587);
  unsigned long t1 = millis();
  Serial.print("delay(587): ");
  Serial.println(t1 - t0);
  Serial.println("DONE");
}

void loop() {}
