// Multiple Sensors
// Learn: How to read from multiple analog sensors simultaneously

const int sensor1Pin = A0;
const int sensor2Pin = A1;
const int sensor3Pin = A2;

void setup() {
  Serial.begin(115200);
  Serial.println("Multiple Sensors Example");
  Serial.println("=======================");
}

void loop() {
  // Read all sensors
  int sensor1Value = analogRead(sensor1Pin);
  int sensor2Value = analogRead(sensor2Pin);
  int sensor3Value = analogRead(sensor3Pin);
  
  // Print all values
  Serial.print("Sensor 1: ");
  Serial.print(sensor1Value);
  Serial.print(" | Sensor 2: ");
  Serial.print(sensor2Value);
  Serial.print(" | Sensor 3: ");
  Serial.println(sensor3Value);
  
  delay(500);
}
