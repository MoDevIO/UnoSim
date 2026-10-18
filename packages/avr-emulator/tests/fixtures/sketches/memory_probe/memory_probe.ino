// Memory layout as the sketch sees it: RAMEND, SP, free RAM, EEPROM.
#include <EEPROM.h>

extern int __bss_end;
extern char *__brkval;

static int freeRam() {
  char top;
  return &top - (__brkval ? __brkval : (char *)&__bss_end);
}

void setup() {
  uint16_t sp = SP;
  Serial.begin(115200);
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.print("SP in setup = 0x");
  Serial.println(sp, HEX);
  Serial.print("__bss_end = 0x");
  Serial.println((uint16_t)&__bss_end, HEX);
  Serial.print("free = ");
  Serial.println(freeRam());
  EEPROM.write(17, 42);
  Serial.print("EEPROM[17] = ");
  Serial.println(EEPROM.read(17));
  Serial.print("E2END = ");
  Serial.println(E2END);
  Serial.println("DONE");
}
void loop() {}
