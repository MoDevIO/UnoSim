// 03 - Store data with primitive data types
// Learn: int, float, char, boolean data types

void setup() {
  Serial.begin(115200);
  
  // Integer - whole numbers
  int age = 25;
  Serial.print("Age: ");
  Serial.println(age);
  
  // Float - decimal numbers
  float temperature = 23.5;
  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.println(" C");
  
  // Character - single character
  char letter = 'A';
  Serial.print("Letter: ");
  Serial.println(letter);
  
  // Boolean - true/false
  boolean isPowered = true;
  Serial.print("Powered: ");
  Serial.println(isPowered);
  
  // String - text
  String name = "Arduino";
  Serial.print("Name: ");
  Serial.println(name);
}

void loop() {
  // Demonstration complete - just wait
  delay(10000);
}
