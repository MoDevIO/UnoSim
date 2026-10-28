// SP as the C runtime leaves it before main(): captured in .init3, after .init2 set the stack pointer.
uint16_t spAtInit __attribute__((section(".noinit")));
void captureSp(void) __attribute__((naked, section(".init3"), used));
void captureSp(void) {
  spAtInit = SP;
}

void setup() {
  Serial.begin(115200);
  Serial.print("SP at init3 = 0x");
  Serial.println(spAtInit, HEX);
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.println("DONE");
}

void loop() {}
