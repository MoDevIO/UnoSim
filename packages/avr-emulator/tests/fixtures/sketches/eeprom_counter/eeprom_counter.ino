// Prints EEPROM cell 0 and stores the next value: a run that starts later sees what the run before wrote.
#include <EEPROM.h>

void setup() {
  Serial.begin(115200);
  byte value = EEPROM.read(0);
  Serial.println(value);
  EEPROM.write(0, value == 255 ? 1 : value + 1);
}

void loop() {}
