// Counter with Serial Output
// Counts from 0 to 100 and prints each number

int counter = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("Counter Started!");
  Serial.println("Counting from 0 to 100...");
}

void loop() {
  // Print the current count
  Serial.println(counter);
  
  // Increment the counter
  counter++;
  
  // Wait 500ms between counts
  delay(500);
  
  // Reset to 0 after reaching 100
  if (counter > 100) {
    counter = 0;
    Serial.println("---");
    Serial.println("Restarting count!");
  }
}
