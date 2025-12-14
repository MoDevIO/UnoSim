// 01 - Data output via Serial Monitor
// Learn: How to output text and values via the Serial Monitor

void setup() {
  Serial.begin(115200);
  Serial.println("=== Serial Monitor Output ===");
  Serial.println("Hello, Arduino!");
  Serial.print("The answer is: ");
  Serial.println(42);
}

void loop() {
  // Demonstration complete - just wait
  delay(10000);
}
