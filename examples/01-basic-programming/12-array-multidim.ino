// 12 - Store data with multidimensional arrays
// Learn: 2D arrays (arrays of arrays)

void setup() {
  Serial.begin(115200);
  Serial.println("=== multidimensional arrays ===");
}

void loop() {
  // 2D Array: sensor measurements from 3 days, 4 measurements each
  int sensors[3][4] = {
    {18, 19, 20, 21},  // Day 1
    {20, 21, 22, 21},  // Day 2
    {21, 22, 23, 22}   // Day 3
  };
  
  Serial.println("Sensor data (3 days, 4 measurements each):");
  
  // Loop through all days
  for (int day = 0; day < 3; day++) {
    Serial.print("Day ");
    Serial.print(day + 1);
    Serial.print(": ");
    
    // Loop through all measurements of a day
    for (int measurement = 0; measurement < 4; measurement++) {
      Serial.print(sensors[day][measurement]);
      Serial.print(" ");
    }
    Serial.println();
  }
  
  Serial.println();
  
  // Average per day
  Serial.println("Average per day:");
  for (int day = 0; day < 3; day++) {
    int sum = 0;
    for (int measurement = 0; measurement < 4; measurement++) {
      sum = sum + sensors[day][measurement];
    }
    float average = sum / 4.0;
    Serial.print("Day ");
    Serial.print(day + 1);
    Serial.print(": ");
    Serial.println(average);
  }
  
  Serial.println();
  
  delay(10000);
}
