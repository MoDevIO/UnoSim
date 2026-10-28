// Diagnostics probe (plan P1.10): sleep with global interrupts disabled.
#include <avr/sleep.h>
void setup() {
  cli();
  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  sleep_enable();
  sleep_cpu();
  sleep_disable();
}
void loop() {}
