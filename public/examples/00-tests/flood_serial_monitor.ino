void flood()
{
      static unsigned long counter = 0;
  // Create a 200-character string to trigger drops at 115200 baud
  // At 115200 baud, 200 chars will take ~173ms using the 10-bit per char calculation
  // But txDelay caps at 10ms, so the mock can push much faster
  char buf[210];
  snprintf(buf, sizeof(buf), "%06lu:", counter);
  memset(buf + 7, 'X', 193);
  buf[200] = '\0';
  Serial.print(millis());
  Serial.print(":");
  Serial.println(buf);
  counter++;
}

void setup() {
  Serial.begin(115200);
  Serial.println("=== Flooding Test Start ===");
}   

void loop() {

  static unsigned long start = millis();
  flood();
  if (millis() - start > 10000) {   // 10 Sekunden
    Serial.println("=== PAUSE ===");
    delay(3000);
    start=millis();
  }

}   