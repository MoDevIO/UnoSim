// ATtiny85 serial probe (plan P6.3): one byte 0xFF has a start bit as its only
// edge pair, too few to find the baud rate; the decoder uses the configured one.
void setup() {
  Serial.begin(9600);
  Serial.write(0xFF);
}

void loop() {}
