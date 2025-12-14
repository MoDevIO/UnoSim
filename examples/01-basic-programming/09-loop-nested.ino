// 09 - Nested loops
// Learn: for loops nested within for loops

void setup() {
  Serial.begin(115200);
  Serial.println("=== Nested loops ===");
}

void loop() {
  // Multiplication table 3x3
  for (int i = 1; i <= 3; i++) {
    for (int j = 1; j <= 3; j++) {
      Serial.print(i * j);
      Serial.print(" ");
    }
    Serial.println();
  }
  
  Serial.println();
  
  // Pyramid of asterisks
  for (int row = 1; row <= 5; row++) {
    for (int star = 0; star < row; star++) {
      Serial.print("* ");
    }
    Serial.println();
  }
  
  Serial.println();
  
  delay(10000);
}
