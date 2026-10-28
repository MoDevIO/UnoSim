// A line "<n> <millis>" every 10 ms (plan P1.8): missing timer overflows or
// serial bytes show up as gaps, a stopped clock as a missing jump.
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long next = 0;
  static unsigned int n = 0;
  if (millis() >= next) {
    Serial.print(n++);
    Serial.print(' ');
    Serial.println(millis());
    next += 10;
  }
}
