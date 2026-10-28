// ATtiny85 profile probe (plan P6.2): a 15 ms watchdog reset; EEPROM byte 0
// counts the boots, byte 1 keeps MCUSR of the last boot.
#include <EEPROM.h>
#include <avr/wdt.h>

void setup() {
  uint8_t cause = MCUSR;
  MCUSR = 0;
  wdt_disable();
  EEPROM.write(0, EEPROM.read(0) + 1);
  EEPROM.write(1, cause);
  wdt_enable(WDTO_15MS);
}

void loop() {}
