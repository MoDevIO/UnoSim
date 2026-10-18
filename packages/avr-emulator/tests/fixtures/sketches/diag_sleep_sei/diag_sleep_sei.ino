// Diagnostics probe (plan P1.10): sleep with global interrupts enabled.
#include <avr/sleep.h>
void setup() {
  set_sleep_mode(SLEEP_MODE_IDLE);
  sleep_enable();
  sei();
  sleep_cpu();
  sleep_disable();
}
void loop() {}
