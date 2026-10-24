// ATtiny85 serial probe (plan P6.3; spike P0.5): serial input over the analog comparator (RX = PB1).
void setup() {
  Serial.begin(9600);
  Serial.println("ready");
}

void loop() {
  if (Serial.available()) {
    int n = Serial.parseInt();
    Serial.print("got ");
    Serial.println(n);
    Serial.print("twice ");
    Serial.println(n * 2);
  }
}
