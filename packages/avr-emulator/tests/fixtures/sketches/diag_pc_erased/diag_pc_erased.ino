// Diagnostics probe (plan P1.10): jump into erased flash behind the program.
void setup() {
  void (*erased)() = (void (*)())0x1000;  // word address, about 8 KB
  erased();
}
void loop() {}
