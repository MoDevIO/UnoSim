void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
}

void loop() {
  static uint32_t t;
  static bool s;
  
  digitalWrite(13, s);
  t=millis();
  s=!s;
  delay(100); // Wait for 1 second
  Serial.println(millis()-t);
}