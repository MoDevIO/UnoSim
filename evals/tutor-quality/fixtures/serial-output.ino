int counter = 3;

void setup() {
  Serial.begin(9600);
  Serial.println(counter);
}

void loop() {
  Serial.println(counter);
  delay(1000);
}
