// elapsedMillis minimal example: two messages at different intervals, without delay().
// The results appear in the serial monitor.
#include <elapsedMillis.h>

elapsedMillis fastTimer;
elapsedMillis slowTimer;

void setup() {
  Serial.begin(115200);
  Serial.println("fast every 250 ms, slow every 1000 ms");
}

void loop() {
  // Subtracting the interval keeps the rhythm even when loop() runs late.
  if (fastTimer >= 250) {
    fastTimer -= 250;
    Serial.print("fast at ");
    Serial.println(millis());
  }
  if (slowTimer >= 1000) {
    slowTimer -= 1000;
    Serial.print("slow at ");
    Serial.println(millis());
  }
}
