// 10 - Nested loops and conditionals
// Learn: for loops combined with if/else conditions

void setup() {
  Serial.begin(115200);
  Serial.println("=== Loops + Conditionals ===");
}

void loop() {
  // Checkerboard pattern (8x8)
  for (int row = 0; row < 8; row++) {
    for (int col = 0; col < 8; col++) {
      if ((row + col) % 2 == 0) {
        Serial.print("# ");
      } else {
        Serial.print("  ");
      }
    }
    Serial.println();
  }
  
  Serial.println();
  
  // Categorize numbers 1-10
  for (int i = 1; i <= 10; i++) {
    Serial.print(i);
    Serial.print(" -> ");
    
    if (i % 2 == 0) {
      if (i < 5) {
        Serial.println("small even");
      } else {
        Serial.println("large even");
      }
    } else {
      if (i < 5) {
        Serial.println("small odd");
      } else {
        Serial.println("large odd");
      }
    }
  }
  
  Serial.println();
  
  delay(10000);
}
