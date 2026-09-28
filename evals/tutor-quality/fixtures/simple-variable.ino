int counter = 3;

void setup() {
  Serial.begin(9600);
  Serial.println(counter);
}

void loop() {
  counter += 1;
  delay(1000);
}
