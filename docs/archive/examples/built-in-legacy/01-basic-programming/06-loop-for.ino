// 06 - Control flow with loops: Counting loop (for)
// Learn: for loops with fixed number of iterations

void setup() {
  Serial.begin(115200);
  Serial.println("=== for-loop (counting loop) ===");
}

void loop() {
  // Count from 1 to 10
  for (int i = 1; i <= 10; i++) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();
  
  // Count backwards
  for (int i = 5; i >= 1; i--) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();
  
  // Count in steps of 2
  for (int i = 0; i <= 10; i += 2) {
    Serial.print(i);
    Serial.print(" ");
  }
  Serial.println();
  
  delay(10000);
}
