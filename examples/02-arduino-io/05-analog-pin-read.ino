// Analog Pin Read
// Learn: How to read analog values (0-1023) from an analog pin

const int sensorPin = A0;  // Analog pin for sensor input

void setup() {
  Serial.begin(115200);
  Serial.println("Analog Pin Read Example");
  Serial.println("======================");
}

void loop() {
  // Read the analog pin
  int sensorValue = analogRead(sensorPin);
  
  // Convert to voltage (0-1023 maps to 0-5V)
  float voltage = (sensorValue / 1023.0) * 5.0;
  
  // Print the values
  Serial.print("Raw Value: ");
  Serial.print(sensorValue);
  Serial.print(" | Voltage: ");
  Serial.print(voltage);
  Serial.println(" V");
  
  delay(500);
}
