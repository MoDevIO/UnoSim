// Diagnostics probe (plan P1.10): a modest recursion stays clear of .bss.
void __attribute__((noinline)) recurse(uint8_t n) {
  volatile uint8_t buffer[20];
  buffer[0] = n;
  if (n > 0) recurse(n - 1);
  buffer[1] = buffer[0];
}
void setup() { recurse(10); }
void loop() {}
