// IoUsageObserver probe (plan P1.9): analogWrite with a PWM duty on pin 9
// must be found as analogWrite only, not as pinMode(OUTPUT).
void setup() { analogWrite(9, 128); }
void loop() {}
