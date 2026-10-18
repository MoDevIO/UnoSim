// randomSeed(42) selects the sequence of avr-libc's random() (Park-Miller
// minimal standard generator); random(max) is random() % max.
void setup() {
  Serial.begin(115200);
  randomSeed(42);
  for (int i = 0; i < 5; i++) {
    Serial.println(random(100));
  }
  Serial.println(random(10, 20));
  Serial.println(random(1000000L));
  randomSeed(42);
  Serial.println(random(100));
  Serial.println("DONE");
}

void loop() {}
