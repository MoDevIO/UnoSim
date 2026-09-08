// 08 - Control flow with loops: Foot-controlled loop (do-while)
// Learn: do-while loops (condition is checked at the end)

void setup() {
  Serial.begin(115200);
  Serial.println("=== do-while-loop (foot-controlled) ===");
}

void loop() {
  int counter = 1;
  
  do {
    Serial.print(counter);
    Serial.print(" ");
    counter++;
  } while (counter <= 5);
  
  Serial.println();
  
  delay(10000);
}
