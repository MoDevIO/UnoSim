// Spike P0.6 – mega_probe plus 150 KB PROGMEM. The linker places the core's
// pin tables above 64 KB, where the core's LPM reads miss them: analogWrite
// leaves the timers untouched. Same instructions as on the board.
#include "bigdata.h"

#define FAR_SUM(arr) for (uint16_t i = 0; i < sizeof(arr); i++) sum += pgm_read_byte_far(pgm_get_far_address(arr) + i)

void setup() {
  uint16_t spAtSetup = SP;
  Serial.begin(115200);
  Serial1.begin(9600);
  Serial2.begin(19200);
  Serial3.begin(57600);
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  Serial.print("sizeof int/long/double = ");
  Serial.print(sizeof(int)); Serial.print("/"); Serial.print(sizeof(long)); Serial.print("/");
  Serial.println(sizeof(double));
  Serial1.println("S1 hello");
  Serial2.println("S2 hello");
  Serial3.println("S3 hello");
  analogWrite(44, 25);
  analogWrite(45, 128);
  analogWrite(46, 200);
  analogWrite(2, 77);
  analogWrite(9, 99);
  analogWrite(13, 10);
  unsigned long t0 = millis();
  delay(587);
  Serial.print("delay(587) = ");
  Serial.println(millis() - t0);
  Serial.print("A0 = ");
  Serial.println(analogRead(A0));
  Serial.print("A15 = ");
  Serial.println(analogRead(A15));
  uint32_t sum = 0;
  FAR_SUM(big0); FAR_SUM(big1); FAR_SUM(big2); FAR_SUM(big3); FAR_SUM(big4);
  Serial.print("far sum = ");
  Serial.println(sum);
  Serial.print("timer of D44 = ");
  Serial.println(digitalPinToTimer(44));
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.print("SP at setup = 0x");
  Serial.println(spAtSetup, HEX);
  Serial.println("DONE");
}

void loop() {}
