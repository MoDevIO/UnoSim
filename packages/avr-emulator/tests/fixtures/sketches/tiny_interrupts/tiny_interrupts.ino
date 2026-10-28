// ATtiny85 profile probe (plan P6.2): INT0 on PB2 (rising) and PCINT0 on PB3
// count edges the test drives; the counts go to EEPROM bytes 0 and 1.
#include <EEPROM.h>

volatile uint8_t int0Count = 0;
volatile uint8_t pcintCount = 0;

void onInt0() { int0Count++; }

ISR(PCINT0_vect) { pcintCount++; }

void setup() {
  pinMode(2, INPUT);
  pinMode(3, INPUT);
  attachInterrupt(0, onInt0, RISING);
  PCMSK |= _BV(PCINT3);
  GIMSK |= _BV(PCIE);
}

void loop() {
  static uint8_t lastInt0 = 0xff;
  static uint8_t lastPcint = 0xff;
  if (int0Count != lastInt0) { lastInt0 = int0Count; EEPROM.write(0, lastInt0); }
  if (pcintCount != lastPcint) { lastPcint = pcintCount; EEPROM.write(1, lastPcint); }
}
