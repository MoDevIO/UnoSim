// Time minimal example: a software clock with a fixed start date, without a real-time clock module.
// The results appear in the serial monitor.
#include <TimeLib.h>

time_t shown = 0;

void printTwoDigits(int number) {
  if (number < 10) Serial.print('0');
  Serial.print(number);
}

void setup() {
  Serial.begin(115200);
  setTime(12, 0, 0, 1, 1, 2026);  // 12:00:00 on 1 January 2026
}

void loop() {
  time_t current = now();
  if (current == shown) return;
  shown = current;

  Serial.print(year(current));
  Serial.print('-');
  printTwoDigits(month(current));
  Serial.print('-');
  printTwoDigits(day(current));
  Serial.print(' ');
  printTwoDigits(hour(current));
  Serial.print(':');
  printTwoDigits(minute(current));
  Serial.print(':');
  printTwoDigits(second(current));
  Serial.println();
}
