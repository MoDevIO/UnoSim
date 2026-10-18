// PWM probe (plan P1.5): every Uno PWM pin with 0, 1, 25, 128, 254, 255,
// then the switch from PWM back to digital; pins 6 and 9 keep running.
const uint8_t pins[] = {3, 5, 6, 9, 10, 11};
const uint8_t values[] = {0, 1, 25, 128, 254, 255};

void setup() {
  Serial.begin(115200);
  for (uint8_t p = 0; p < sizeof(pins); p++) {
    for (uint8_t v = 0; v < sizeof(values); v++) {
      analogWrite(pins[p], values[v]);
      Serial.print("P");
      Serial.print(pins[p]);
      Serial.print("=");
      Serial.println(values[v]);
      Serial.flush();
    }
  }
  analogWrite(9, 128);
  digitalWrite(9, LOW);
  Serial.println("D9 LOW");
  Serial.flush();
  analogWrite(10, 77);
  digitalWrite(10, HIGH);
  Serial.println("D10 HIGH");
  Serial.flush();
  Serial.println("DONE");
  // Keep two PWM outputs running (timer 0 fast PWM, timer 1 phase correct).
  analogWrite(6, 100);
  analogWrite(9, 30);
}

void loop() {}
