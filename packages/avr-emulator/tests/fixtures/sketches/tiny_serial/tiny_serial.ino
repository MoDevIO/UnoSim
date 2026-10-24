// ATtiny85 serial probe (plan P6.3; spike P0.5 tiny_probe) (ATTinyCore, 8 MHz internal): software Serial
// on PB0, time, data types, ADC with three references, PWM, memory layout.
void setup() {
  uint16_t spAtSetup = SP;
  Serial.begin(9600);
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  Serial.print("print(2.5) = ");
  Serial.println(2.5);
  Serial.print("Umlaut: ");
  Serial.println("\xC3\xA4\xC3\xB6\xC3\xBC");
  unsigned long t0 = millis();
  delay(587);
  unsigned long t1 = millis();
  Serial.print("delay(587) = ");
  Serial.println(t1 - t0);
  Serial.print("A1 VCC = ");
  Serial.println(analogRead(A1));
  analogReference(INTERNAL1V1);
  Serial.print("A3 1V1 = ");
  Serial.println(analogRead(A3));
  analogReference(INTERNAL2V56);
  Serial.print("A3 2V56 = ");
  Serial.println(analogRead(A3));
  analogReference(DEFAULT);
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.print("SP at setup = 0x");
  Serial.println(spAtSetup, HEX);
  Serial.println("DONE");
  analogWrite(4, 200);
  analogWrite(0, 77);
}

void loop() {}
