// float is IEEE 754 single precision and double is the same type on AVR.
// Serial.print(float) rounds to 2 digits by default.
volatile float third = 1.0f / 3.0f;
volatile double two = 2.0;

void setup() {
  Serial.begin(115200);
  Serial.println(third);
  Serial.println(third, 6);
  Serial.println(sqrt(two), 6);
  Serial.println(0.1f + 0.2f, 7);
  volatile float big = 16777216.0f;
  Serial.println(big + 1.0f, 1);
  Serial.println(2.5f * 4.0f);
  Serial.println(-0.005f);
  Serial.println(1.0f / 0.0f);
  Serial.println((int)3.99f);
  Serial.println((int)-3.99f);
  Serial.println(round(2.5f));
  Serial.println(PI, 5);
  Serial.println("DONE");
}

void loop() {}
