// The addresses and sizes the toolchain produced for this sketch: where the
// stack stands in setup(), where .bss ends and how much RAM is free. They
// change with the compiler and the core, so this case is a regression guard.
extern int __bss_end;
extern char *__brkval;

static int freeRam() {
  char top;
  return &top - (__brkval ? __brkval : (char *)&__bss_end);
}

void setup() {
  uint16_t sp = SP;
  Serial.begin(115200);
  Serial.print("SP in setup = 0x");
  Serial.println(sp, HEX);
  Serial.print("__bss_end = 0x");
  Serial.println((uint16_t)&__bss_end, HEX);
  Serial.print("free = ");
  Serial.println(freeRam());
  Serial.println("DONE");
}

void loop() {}
