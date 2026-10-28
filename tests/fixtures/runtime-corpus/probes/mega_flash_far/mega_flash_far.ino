// The flash of the ATmega2560 is 256 KB: PROGMEM above 64 KB needs the far
// instructions (ELPM, RAMPZ), code above 128 KB needs the 22-bit program
// counter and the EIND trampolines for indirect calls. Four tables of 34000
// bytes (value of byte i of table k: (i * 31 + k * 7) mod 256) push the data
// past 64 KB and the code of the sketch past 128 KB.
#include <avr/pgmspace.h>

#define TABLE(k)                                  \
  ".global big" #k "\n"                           \
  "big" #k ":\n"                                  \
  ".set i" #k ", 0\n"                             \
  ".rept 34000\n"                                 \
  ".byte (i" #k " * 31 + " #k " * 7) & 0xff\n"    \
  ".set i" #k ", i" #k " + 1\n"                   \
  ".endr\n"

__asm__(".section .progmem.data,\"a\",@progbits\n" TABLE(0) TABLE(1) TABLE(2) TABLE(3) ".text\n");
extern const uint8_t big0[] PROGMEM;
extern const uint8_t big1[] PROGMEM;
extern const uint8_t big2[] PROGMEM;
extern const uint8_t big3[] PROGMEM;

static const uint32_t LENGTH = 34000;

static uint32_t sum(uint_farptr_t table) {
  uint32_t total = 0;
  for (uint32_t i = 0; i < LENGTH; i++) total += pgm_read_byte_far(table + i);
  return total;
}

static void (*volatile highCall)(void);
static void marker() { Serial.println("indirect call ok"); }

void setup() {
  Serial.begin(115200);
  Serial.print("table 0 sum = ");
  Serial.println(sum(pgm_get_far_address(big0)));
  Serial.print("table 1 sum = ");
  Serial.println(sum(pgm_get_far_address(big1)));
  Serial.print("table 2 sum = ");
  Serial.println(sum(pgm_get_far_address(big2)));
  Serial.print("table 3 sum = ");
  Serial.println(sum(pgm_get_far_address(big3)));
  Serial.print("table 3 starts above 64 KB: ");
  Serial.println(pgm_get_far_address(big3) > 0x10000UL);
  Serial.print("table 3 byte 33999 = ");
  Serial.println(pgm_read_byte_far(pgm_get_far_address(big3) + 33999));
  highCall = marker;
  highCall();
  Serial.println("DONE");
}

void loop() {}
