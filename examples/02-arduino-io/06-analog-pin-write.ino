// Analog Pin Write (PWM)
// Learn: How to write analog values (0-255) using PWM to control brightness/speed

const int pwmPin = 9;  // PWM pin (supports analogWrite)

void setup() {
  Serial.begin(115200);
  pinMode(pwmPin, OUTPUT);
  Serial.println("Analog Pin Write (PWM) Example");
  Serial.println("==============================");
}

void loop() {
  // Write different PWM values (0-255)
  for (int pwmValue = 0; pwmValue <= 255; pwmValue += 51) {
    analogWrite(pwmPin, pwmValue);
    Serial.print("PWM Value: ");
    Serial.print(pwmValue);
    Serial.print(" | Percentage: ");
    Serial.print((pwmValue / 255.0) * 100);
    Serial.println(" %");
    delay(500);
  }
}
