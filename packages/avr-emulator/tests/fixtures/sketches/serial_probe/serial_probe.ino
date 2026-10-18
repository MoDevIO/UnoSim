// Serial probe (plan P1.7): UTF-8 output, input through parseInt() and the
// 1 s timeout of Stream.
void setup() {
  Serial.begin(9600);
  Serial.println("Grüße: äöü € 😀");
}

void loop() {
  if (Serial.available()) {
    unsigned long start = millis();
    long n = Serial.parseInt();
    Serial.print("n=");
    Serial.print(n);
    Serial.print(" after ");
    Serial.print(millis() - start);
    Serial.println(" ms");
  }
}
