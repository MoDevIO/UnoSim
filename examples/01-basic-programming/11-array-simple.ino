// 11 - Store data with simple arrays
// Learn: Arrays to store multiple values

void setup() {
  Serial.begin(115200);
  Serial.println("=== simple arrays ===");
}

void loop() {
  // Array with temperatures
  int temperatures[5] = {20, 22, 21, 23, 22};
  
  Serial.println("Temperatures from last 5 measurements:");
  for (int i = 0; i < 5; i++) {
    Serial.print("Measurement ");
    Serial.print(i + 1);
    Serial.print(": ");
    Serial.print(temperatures[i]);
    Serial.println(" C");
  }
  
  Serial.println();
  
  // Calculate average
  int sum = 0;
  for (int i = 0; i < 5; i++) {
    sum = sum + temperatures[i];
  }
  float average = sum / 5.0;
  Serial.print("Average: ");
  Serial.println(average);
  
  Serial.println();
  
  // Maximum and minimum value
  int maxTemp = temperatures[0];
  int minTemp = temperatures[0];
  
  for (int i = 1; i < 5; i++) {
    if (temperatures[i] > maxTemp) {
      maxTemp = temperatures[i];
    }
    if (temperatures[i] < minTemp) {
      minTemp = temperatures[i];
    }
  }
  
  Serial.print("Max: ");
  Serial.print(maxTemp);
  Serial.print(" C, Min: ");
  Serial.print(minTemp);
  Serial.println(" C");
  
  Serial.println();
  
  delay(10000);
}
