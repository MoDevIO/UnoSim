// Memory facts that follow from the ATmega2560 datasheet and avr-libc, stated
// as yes/no so that they do not depend on the compiler's frame sizes.
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
  Serial.print("RAMEND = ");
  Serial.println(RAMEND);
  Serial.print("E2END = ");
  Serial.println(E2END);
  Serial.print("FLASHEND = ");
  Serial.println((unsigned long)FLASHEND);
  Serial.print("SP near RAMEND: ");
  Serial.println(sp <= RAMEND && sp > RAMEND - 64);
  Serial.print("bss starts after the extended I/O space: ");
  Serial.println((uint16_t)&__bss_end > 0x200);
  Serial.print("free RAM below 8192: ");
  Serial.println(freeRam() > 0 && freeRam() < 8192);
  char *block = (char *)malloc(100);
  Serial.print("malloc(100) inside SRAM: ");
  Serial.println((uint16_t)block > 0x200 && (uint16_t)block + 100 <= RAMEND);
  Serial.print("heap below stack: ");
  Serial.println((uint16_t)block + 100 < sp);
  EEPROM.write(17, 42);
  EEPROM.write(4095, 7);
  Serial.print("EEPROM[17] = ");
  Serial.println(EEPROM.read(17));
  Serial.print("EEPROM[4095] = ");
  Serial.println(EEPROM.read(4095));
  Serial.print("EEPROM erased = ");
  Serial.println(EEPROM.read(500));
  Serial.println("DONE");
}

void loop() {}
