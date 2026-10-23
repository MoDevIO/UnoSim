// ATtiny85 profile probe (plan P6.2): results in EEPROM, read by the test.
// ATTinyCore 1.5.2, ATTinyCore:avr:attinyx5:chip=85,clock=8internal.
#include <EEPROM.h>

void put16(int address, uint16_t value) {
  EEPROM.write(address, value & 0xff);
  EEPROM.write(address + 1, value >> 8);
}

void setup() {
  uint16_t spAtSetup = SP;
  unsigned long t0 = millis();
  delay(587);
  unsigned long t1 = millis();
  put16(0, spAtSetup);
  put16(2, t1 - t0);
  put16(4, analogRead(A1));      // PB2, reference VCC
  analogReference(INTERNAL1V1);
  put16(6, analogRead(A3));      // PB3
  analogReference(INTERNAL2V56);
  put16(8, analogRead(A3));
  analogReference(DEFAULT);
  put16(10, RAMEND);
  EEPROM.write(12, 0xA5);        // done
  analogWrite(4, 200);           // timer 1, OC1B
  analogWrite(0, 77);            // timer 0, OC0A
}

void loop() {}
