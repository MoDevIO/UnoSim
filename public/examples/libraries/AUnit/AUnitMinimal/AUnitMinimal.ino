// AUnit minimal example: one passing unit test.
// The results appear in the serial monitor.
#include <AUnit.h>

test(addition) {
  assertEqual(2 + 3, 5);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  aunit::TestRunner::run();
}
