// ATtiny85 probe (plan P6.5): INT0 (PB2, rising) and the pin-change interrupt
// on PB3 count the edges the case drives; the counts are printed at the end.
volatile uint8_t int0Count = 0;
volatile uint8_t pcintCount = 0;

void onInt0() { int0Count++; }

ISR(PCINT0_vect) { pcintCount++; }

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT);
  pinMode(3, INPUT);
  attachInterrupt(0, onInt0, RISING);
  PCMSK |= _BV(PCINT3);
  GIMSK |= _BV(PCIE);
}

void loop() {
  if (millis() > 400) {
    Serial.print("INT0 ");
    Serial.println(int0Count);
    Serial.print("PCINT ");
    Serial.println(pcintCount);
    while (true) {}
  }
}
