// 04 - Control flow with if/else
// Learn: Conditional queries with if and else

void setup() {
  Serial.begin(115200);
  Serial.println("=== if/else Example ===");
}

void loop() {
  int hour = 14; // Example hour
  
  Serial.print("Hour: ");
  Serial.print(hour);
  Serial.print(" -> ");
  
  // simple if query
  if (hour < 12) {
    Serial.println("Good morning!");
  }
  else if (hour < 18) {
    Serial.println("Good afternoon!");
  }
  else {
    Serial.println("Good evening!");
  }
  
  delay(10000);
}
