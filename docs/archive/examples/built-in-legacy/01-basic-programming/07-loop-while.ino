// 07 - Control flow with loops: Head-controlled loop (while)
// Learn: while loops (condition is checked at the beginning)

void setup() {
  Serial.begin(115200);
  Serial.println("=== while-loop (head-controlled) ===");
}

void loop() {
  int counter = 1;
  
  while (counter <= 5) {
    Serial.print(counter);
    Serial.print(" ");
    counter++;
  }
  Serial.println();
  
  delay(10000);
}
