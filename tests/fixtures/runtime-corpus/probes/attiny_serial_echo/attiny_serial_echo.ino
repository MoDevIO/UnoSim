// ATtiny85 probe (plan P6.5): Serial input through the analog comparator (RX on
// PB1): parseInt echoes numbers; input sent before Serial.begin() is lost.
void setup() {
  delay(100);
  Serial.begin(9600);
  Serial.println("ready");
}

void loop() {
  if (Serial.available()) {
    int n = Serial.parseInt();
    Serial.print("got ");
    Serial.println(n);
  }
}
