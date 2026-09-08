// Read an analog pin and show its value in the Serial Monitor.
void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.print("A0: ");
  Serial.println(analogRead(A0));
  delay(250);
}
