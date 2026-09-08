void setup() {
  Serial.begin(115200);
  // Print a progress, then clear line and print new progress
  Serial.print("Progress: 10%");
  delay(100);
  // ESC[K = \x1b[K
  Serial.print("\x1b[K");
  Serial.print("Progress: 20%\n");
}

void loop() {}
