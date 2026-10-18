// Diagnostics probe (plan P1.10): 600 bytes of .bss leave about 1.4 KB for
// the stack; the recursion needs about 1.6 KB, so the stack pointer drops
// below the end of .bss (and stays above the I/O registers).
volatile uint8_t padding[600];
void __attribute__((noinline)) recurse(uint8_t n) {
  volatile uint8_t buffer[100];
  buffer[0] = n;
  if (n > 0) recurse(n - 1);
  buffer[1] = buffer[0];
}
void setup() {
  padding[0] = 1;
  recurse(14);
}
void loop() {}
