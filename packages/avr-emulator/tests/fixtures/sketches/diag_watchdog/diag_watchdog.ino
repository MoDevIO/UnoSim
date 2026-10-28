// Diagnostics probe (plan P1.10): the watchdog resets the sketch after 15 ms.
#include <avr/wdt.h>
void setup() {
  wdt_enable(WDTO_15MS);
  while (true) {}
}
void loop() {}
