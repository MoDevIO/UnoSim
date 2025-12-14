// 05 - Nested conditional branches
// Learn: if/else statements nested multiple times

void setup() {
  Serial.begin(115200);
  Serial.println("=== Nested if/else ===");
}

void loop() {
  // Test multiple different sensor values
  int sensorValues[5] = {25, 75, 150, 215, 240};
  
  for (int i = 0; i < 5; i++) {
    int sensor = sensorValues[i];
    
    Serial.print("Sensor: ");
    Serial.print(sensor);
    Serial.print(" -> ");
    
    // Outer if query
    if (sensor < 100) {
      Serial.print("DARK: ");
      
      // Inner if query
      if (sensor < 50) {
        Serial.println("very dark");
      }
      else {
        Serial.println("dark");
      }
    }
    else if (sensor < 200) {
      Serial.println("DIMMED");
    }
    else {
      Serial.print("BRIGHT: ");
      
      // Inner if query
      if (sensor > 230) {
        Serial.println("very bright");
      }
      else {
        Serial.println("bright");
      }
    }
  }
  
  delay(10000);
}
