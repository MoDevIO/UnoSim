// Sine Plotter Example
// Prints a sine wave value to Serial at 10Hz for plotting in the Serial Plotter

#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  // Wait for Serial on native USB boards (harmless on others)
  unsigned long start = millis();
  while (!Serial && millis() - start < 2000) {}
}

void loop() {
  static unsigned long startMs = millis();
  unsigned long ms = millis() - startMs;

  // Frequency: 0.5 Hz (one cycle every 2 seconds)
  const float freq = 0.5;
  const float twoPi = 6.283185307179586;
  float t = (ms / 1000.0) * freq * twoPi; // radians

  // Scale to a convenient plotting range
  float value = sin(t) * 40.0 + 60.0 * millis()/1000; // range ~20..100

  // Print numeric value — the plotter will pick up the number
  Serial.print(2*value, 2);
  Serial.print("\t");
  Serial.print(value, 2);
  Serial.println();

  delay(100); // 10 Hz update
}
