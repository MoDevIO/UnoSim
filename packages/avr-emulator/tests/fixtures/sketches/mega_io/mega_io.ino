// Digital and analog pins on ports with extended I/O addresses (H, J, K, L)
// and on the I/O space (A), PWM on timer 4 and 5, ADC channel above 7 (MUX5).
void setup() {
  Serial.begin(115200);
  pinMode(22, OUTPUT); digitalWrite(22, HIGH);  // PA0
  pinMode(42, OUTPUT); digitalWrite(42, HIGH);  // PL7
  pinMode(7, OUTPUT);  digitalWrite(7, LOW);    // PH4
  pinMode(15, INPUT_PULLUP);                    // PJ0
  pinMode(62, INPUT);                           // PK0
  Serial.println(digitalRead(15));
  Serial.println(digitalRead(62));
  analogWrite(8, 100);                          // OC4C
  analogWrite(46, 200);                         // OC5A
  Serial.println(analogRead(A8));
  Serial.println(analogRead(3));
  Serial.println("DONE");
}

void loop() {}
