// IoUsageObserver probe (plan P1.9): analogWrite(0) and analogWrite(255) are
// digitalWrite in the core, so they are found as pinMode + digitalWrite.
void setup() { analogWrite(10, 255); analogWrite(11, 0); }
void loop() {}
