// External and pin-change interrupts of the ATmega2560: INT0–INT5 on pins
// 21, 20, 19, 18, 2, 3 and one pin of each pin-change group (PCINT0 on pin 10,
// PCINT1 on pin 15 = PJ0, PCINT2 on pin 62 = A8). Counts every falling edge.
volatile uint8_t hits[6];
volatile uint8_t pcint[3];

void onInt0() { hits[0]++; }
void onInt1() { hits[1]++; }
void onInt2() { hits[2]++; }
void onInt3() { hits[3]++; }
void onInt4() { hits[4]++; }
void onInt5() { hits[5]++; }
ISR(PCINT0_vect) { pcint[0]++; }
ISR(PCINT1_vect) { pcint[1]++; }
ISR(PCINT2_vect) { pcint[2]++; }

void setup() {
  Serial.begin(115200);
  const uint8_t pins[6] = {21, 20, 19, 18, 2, 3};
  void (*const handlers[6])() = {onInt0, onInt1, onInt2, onInt3, onInt4, onInt5};
  for (uint8_t i = 0; i < 6; i++) {
    pinMode(pins[i], INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(pins[i]), handlers[i], FALLING);
  }
  pinMode(10, INPUT_PULLUP);
  pinMode(15, INPUT_PULLUP);
  pinMode(62, INPUT_PULLUP);
  PCICR |= _BV(PCIE0) | _BV(PCIE1) | _BV(PCIE2);
  PCMSK0 |= _BV(PCINT4);   // pin 10 = PB4
  PCMSK1 |= _BV(PCINT9);   // pin 15 = PJ0
  PCMSK2 |= _BV(PCINT16);  // pin 62 = PK0
  Serial.println("READY");
}

void loop() {
  delay(200);
  for (uint8_t i = 0; i < 6; i++) { Serial.print("INT"); Serial.print(i); Serial.print('='); Serial.print(hits[i]); Serial.print(' '); }
  Serial.print("PCINT0="); Serial.print(pcint[0]);
  Serial.print(" PCINT1="); Serial.print(pcint[1]);
  Serial.print(" PCINT2="); Serial.println(pcint[2]);
  Serial.println("DONE");
  while (true) {}
}
