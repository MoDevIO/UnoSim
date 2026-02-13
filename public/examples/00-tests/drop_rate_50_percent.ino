/**
 * Test: Genau 50% Drop-Rate (kontinuierlich)
 * 
 * Logik:
 * - Sendet alle 5ms eine Zeile (200 bytes)
 * - Das erzeugt ~40 kB/s intended
 * - Budget bei 115200 Baud: ~11.5 kB/s
 * - Drop-Rate: (40 - 11.5) / 40 = ~71% gedroppt
 * - Um 50% zu erreichen: 20 kB/s intended → 2ms delay
 */

void setup() {
  Serial.begin(115200);
  Serial.println("=== 50% Drop Rate Test ===");
  Serial.println("Will run indefinitely, generating drops...");
  delay(1000);
}

void loop() {
  static unsigned long counter = 0;
  
  // Create 200-byte line (short enough to stay alive)
  char buf[210];
  snprintf(buf, sizeof(buf), "[%06lu] ", counter);
  
  // Fill rest with data
  int len = strlen(buf);
  memset(buf + len, 'X', 180 - len);
  buf[180] = '\0';
  
  Serial.println(buf);
  counter++;
  
  // 2ms delay → ~500 lines/sec → ~100 kB/s intended
  // Budget is ~11.5 kB/s → ~88% dropped (well above 50%)
  delayMicroseconds(2000);
}
