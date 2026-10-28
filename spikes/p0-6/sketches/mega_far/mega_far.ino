// Spike P0.6 – Mega 2560 far probe: 150 KB PROGMEM push the code above 128 KB
// (22-bit PC, EIND trampolines) and the HEX above 64 KB (record type 02).
#include "bigdata.h"

#define FAR_SUM(arr) for (uint16_t i = 0; i < sizeof(arr); i++) sum += pgm_read_byte_far(pgm_get_far_address(arr) + i)

static void (*volatile highCall)(void);
static void marker() { Serial.println("indirect call ok"); }

void setup() {
  Serial.begin(115200);
  uint32_t sum = 0;
  FAR_SUM(big0); FAR_SUM(big1); FAR_SUM(big2); FAR_SUM(big3); FAR_SUM(big4);
  Serial.print("far sum = ");
  Serial.println(sum);
  highCall = marker;
  highCall();
  unsigned long t0 = millis();
  delay(100);
  Serial.print("delay(100) = ");
  Serial.println(millis() - t0);
  // The core reads its pin tables with LPM; above 64 KB that misses them.
  Serial.print("timer of D44 = ");
  Serial.println(digitalPinToTimer(44));
  Serial.println("DONE");
}

void loop() {}
