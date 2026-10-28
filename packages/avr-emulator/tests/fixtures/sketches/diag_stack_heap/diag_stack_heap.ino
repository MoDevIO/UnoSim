// Diagnostics probe (plan P1.10): 1000 bytes of heap and a stack of about
// 1.3 KB meet; the stack stays above the end of .bss but drops below __brkval.
#include <stdlib.h>
void __attribute__((noinline)) recurse(uint8_t n) {
  volatile uint8_t buffer[100];
  buffer[0] = n;
  if (n > 0) recurse(n - 1);
  buffer[1] = buffer[0];
}
void setup() {
  volatile uint8_t* heap = (uint8_t*)malloc(1000);
  heap[0] = 1;
  recurse(12);
}
void loop() {}
