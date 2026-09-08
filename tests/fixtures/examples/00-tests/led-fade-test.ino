/*
 * LED Fade Test - Tests verschiedene Blinkfrequenzen
 * Ziel: Validierung der Fade-Out-Logik (50ms Fade-Dauer)
 * 
 * Frequenzen:
 * - 1Hz (1000ms): Deutliches Flackern
 * - 5Hz (200ms): Sichtbares Flackern  
 * - 30Hz (33ms): Sanftes Glimmen
 * - 50Hz+ (≤20ms): Konstantes Leuchten
 */

int currentFrequency = 5; // Start with 5Hz

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
  
  Serial.println("=== LED Fade Test ===");
  Serial.println("Mit FADE_OUT_MS = 50ms");
  Serial.println("");
  Serial.println("Current frequency: 5Hz (200ms period)");
  Serial.println("Expected: Sichtbares Flackern");
  Serial.println("");
}

void loop() {
  // Frequencies to test (Hz)
  int frequencies[] = {1, 5, 30, 50};
  
  // Test each frequency for 10 cycles
  for (int freqIdx = 0; freqIdx < 4; freqIdx++) {
    int freq = frequencies[freqIdx];
    long period = 1000 / freq; // Period in milliseconds
    long halfPeriod = period / 2;
    
    Serial.print("Testing ");
    Serial.print(freq);
    Serial.print("Hz (");
    Serial.print(period);
    Serial.println("ms period)...");
    
    // Run for 10 complete cycles
    for (int cycle = 0; cycle < 10; cycle++) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(halfPeriod);
      digitalWrite(LED_BUILTIN, LOW);
      delay(halfPeriod);
    }
    
    // Pause between frequencies
    Serial.println("  Done!");
    delay(500);
  }
  
  Serial.println("");
  Serial.println("Test cycle complete. Restarting...");
  delay(2000);
}
