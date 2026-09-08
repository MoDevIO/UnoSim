// 02 - Data input via Serial Monitor
// Learn: How to read data from the Serial Monitor

void setup() {
  Serial.begin(115200);
  Serial.println("Enter a number and press Enter:");
}

void loop() {
  if (Serial.available() > 0) {
    int number = Serial.parseInt();
    Serial.print("You entered: ");
    Serial.println(number);
    Serial.println("Enter another number and press Enter:");
  }
}
