// Temperature Sensor
// Simulates reading a temperature sensor and prints it to serial

int sensorPin = A0;
int sensorValue = 0;
float temperature = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("Temperature Sensor Started");
  Serial.println("========================");
}

void loop() {
  // Read the analog value from the sensor
  sensorValue = analogRead(sensorPin);
  
  // Convert to temperature (0-1023 maps to 0-50°C)
  temperature = (sensorValue / 1023.0) * 50.0;
  
  // Print the temperature
  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.println(" C");
  
  // Wait 2 seconds before next reading
  delay(2000);
}
