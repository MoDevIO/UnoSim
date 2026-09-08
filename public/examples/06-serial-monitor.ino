// Send a small stream of readable messages to the Serial Monitor.
void setup() {
  Serial.begin(115200);
  Serial.println("UnoSim serial monitor demo");
}

void loop() {
  Serial.print("millis = ");
  Serial.println(millis());
  delay(1000);
}
